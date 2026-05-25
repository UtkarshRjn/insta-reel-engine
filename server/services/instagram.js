import axios from 'axios';

// Instagram API with Instagram Login (no Facebook Pages involved)
// Dashboard: Meta app → Instagram → API setup with Instagram login
const IG_GRAPH_API_URL = 'https://graph.instagram.com/v21.0';
const IG_OAUTH_AUTHORIZE = 'https://www.instagram.com/oauth/authorize';
const IG_OAUTH_TOKEN = 'https://api.instagram.com/oauth/access_token';

export function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    scope: 'instagram_business_basic,instagram_business_content_publish',
    response_type: 'code'
  });

  return `${IG_OAUTH_AUTHORIZE}?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const formData = new URLSearchParams();
  formData.append('client_id', process.env.INSTAGRAM_APP_ID);
  formData.append('client_secret', process.env.INSTAGRAM_APP_SECRET);
  formData.append('grant_type', 'authorization_code');
  formData.append('redirect_uri', process.env.INSTAGRAM_REDIRECT_URI);
  formData.append('code', code);

  const response = await axios.post(IG_OAUTH_TOKEN, formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  // { access_token, user_id, permissions }
  return response.data;
}

export async function getLongLivedToken(shortLivedToken) {
  const response = await axios.get(`${IG_GRAPH_API_URL}/access_token`, {
    params: {
      grant_type: 'ig_exchange_token',
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      access_token: shortLivedToken
    }
  });

  // { access_token, token_type: 'bearer', expires_in }
  return response.data;
}

// Returns the IG user ID (no FB Pages indirection in this flow).
// Signature kept compatible with existing callers; pageAccessToken is always null.
export async function getInstagramAccountId(accessToken) {
  const response = await axios.get(`${IG_GRAPH_API_URL}/me`, {
    params: {
      fields: 'user_id',
      access_token: accessToken
    }
  });

  const igUserId = response.data.user_id || response.data.id;
  if (!igUserId) {
    throw new Error('Could not resolve Instagram user id from token.');
  }

  return {
    instagramAccountId: igUserId,
    pageAccessToken: null
  };
}

export async function getUserProfile(accessToken /* , instagramAccountId */) {
  const response = await axios.get(`${IG_GRAPH_API_URL}/me`, {
    params: {
      fields: 'username,name,profile_picture_url,account_type,user_id',
      access_token: accessToken
    }
  });

  return response.data;
}

export async function refreshLongLivedToken(currentToken) {
  const { saveToken, getToken } = await import('../db.js');

  const response = await axios.get(`${IG_GRAPH_API_URL}/refresh_access_token`, {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: currentToken
    }
  });

  const existing = getToken();
  if (existing) {
    saveToken({
      instagramAccountId: existing.instagram_account_id,
      accessToken: response.data.access_token,
      pageAccessToken: null,
      username: existing.username,
      expiresAt: Date.now() + (response.data.expires_in * 1000)
    });
  }

  return response.data;
}

async function waitForContainerReady(containerId, accessToken, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await axios.get(`${IG_GRAPH_API_URL}/${containerId}`, {
      params: {
        fields: 'status_code,status',
        access_token: accessToken
      }
    });

    const { status_code } = response.data;

    if (status_code === 'FINISHED') {
      return true;
    }

    if (status_code === 'ERROR') {
      throw new Error('Media container creation failed');
    }

    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  throw new Error('Timeout waiting for media container to be ready');
}

export async function postReel(accessToken, instagramAccountId, videoUrl, caption) {
  const containerResponse = await axios.post(
    `${IG_GRAPH_API_URL}/${instagramAccountId}/media`,
    null,
    {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        access_token: accessToken
      }
    }
  );

  const containerId = containerResponse.data.id;
  await waitForContainerReady(containerId, accessToken);

  const publishResponse = await axios.post(
    `${IG_GRAPH_API_URL}/${instagramAccountId}/media_publish`,
    null,
    {
      params: {
        creation_id: containerId,
        access_token: accessToken
      }
    }
  );

  return publishResponse.data;
}

export async function postCarousel(accessToken, instagramAccountId, imageUrls, caption) {
  const childIds = [];
  for (const imageUrl of imageUrls) {
    const childResponse = await axios.post(
      `${IG_GRAPH_API_URL}/${instagramAccountId}/media`,
      null,
      {
        params: {
          image_url: imageUrl,
          is_carousel_item: true,
          access_token: accessToken
        }
      }
    );
    childIds.push(childResponse.data.id);
  }

  for (const childId of childIds) {
    await waitForContainerReady(childId, accessToken);
  }

  const carouselResponse = await axios.post(
    `${IG_GRAPH_API_URL}/${instagramAccountId}/media`,
    null,
    {
      params: {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
        access_token: accessToken
      }
    }
  );

  const carouselId = carouselResponse.data.id;
  await waitForContainerReady(carouselId, accessToken);

  const publishResponse = await axios.post(
    `${IG_GRAPH_API_URL}/${instagramAccountId}/media_publish`,
    null,
    {
      params: {
        creation_id: carouselId,
        access_token: accessToken
      }
    }
  );

  return publishResponse.data;
}

export async function postImage(accessToken, instagramAccountId, imageUrl, caption) {
  const containerResponse = await axios.post(
    `${IG_GRAPH_API_URL}/${instagramAccountId}/media`,
    null,
    {
      params: {
        image_url: imageUrl,
        caption,
        access_token: accessToken
      }
    }
  );

  const containerId = containerResponse.data.id;
  await waitForContainerReady(containerId, accessToken);

  const publishResponse = await axios.post(
    `${IG_GRAPH_API_URL}/${instagramAccountId}/media_publish`,
    null,
    {
      params: {
        creation_id: containerId,
        access_token: accessToken
      }
    }
  );

  return publishResponse.data;
}
