import axios from 'axios';

const GRAPH_API_URL = 'https://graph.facebook.com/v18.0';

export function getAuthUrl() {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID,
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
    scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
    response_type: 'code'
  });

  return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const response = await axios.get(`${GRAPH_API_URL}/oauth/access_token`, {
    params: {
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code
    }
  });

  return response.data;
}

export async function getLongLivedToken(shortLivedToken) {
  const response = await axios.get(`${GRAPH_API_URL}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      fb_exchange_token: shortLivedToken
    }
  });

  return response.data;
}

export async function getInstagramAccountId(accessToken) {
  // First get the Facebook Pages
  const pagesResponse = await axios.get(`${GRAPH_API_URL}/me/accounts`, {
    params: { access_token: accessToken }
  });

  if (!pagesResponse.data.data || pagesResponse.data.data.length === 0) {
    throw new Error('No Facebook Pages found. You need a Facebook Page connected to your Instagram account.');
  }

  const pageId = pagesResponse.data.data[0].id;
  const pageAccessToken = pagesResponse.data.data[0].access_token;

  // Get the Instagram Business Account connected to this page
  const igResponse = await axios.get(`${GRAPH_API_URL}/${pageId}`, {
    params: {
      fields: 'instagram_business_account',
      access_token: pageAccessToken
    }
  });

  if (!igResponse.data.instagram_business_account) {
    throw new Error('No Instagram Business Account connected to your Facebook Page.');
  }

  return {
    instagramAccountId: igResponse.data.instagram_business_account.id,
    pageAccessToken
  };
}

export async function postReel(accessToken, instagramAccountId, videoUrl, caption) {
  // Step 1: Create a media container
  const containerResponse = await axios.post(
    `${GRAPH_API_URL}/${instagramAccountId}/media`,
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

  // Step 2: Wait for the container to be ready
  await waitForContainerReady(containerId, accessToken);

  // Step 3: Publish the reel
  const publishResponse = await axios.post(
    `${GRAPH_API_URL}/${instagramAccountId}/media_publish`,
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

async function waitForContainerReady(containerId, accessToken, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await axios.get(`${GRAPH_API_URL}/${containerId}`, {
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

    // Wait 10 seconds before next check
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  throw new Error('Timeout waiting for media container to be ready');
}

export async function postCarousel(accessToken, instagramAccountId, imageUrls, caption) {
  // Step 1: Create child containers for each image
  const childIds = [];
  for (const imageUrl of imageUrls) {
    const childResponse = await axios.post(
      `${GRAPH_API_URL}/${instagramAccountId}/media`,
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

  // Step 2: Wait for all children to be ready
  for (const childId of childIds) {
    await waitForContainerReady(childId, accessToken);
  }

  // Step 3: Create carousel container
  const carouselResponse = await axios.post(
    `${GRAPH_API_URL}/${instagramAccountId}/media`,
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

  // Step 4: Wait for carousel to be ready
  await waitForContainerReady(carouselId, accessToken);

  // Step 5: Publish
  const publishResponse = await axios.post(
    `${GRAPH_API_URL}/${instagramAccountId}/media_publish`,
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
  // Step 1: Create a media container for image
  const containerResponse = await axios.post(
    `${GRAPH_API_URL}/${instagramAccountId}/media`,
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

  // Step 2: Wait for the container to be ready
  await waitForContainerReady(containerId, accessToken);

  // Step 3: Publish the image post
  const publishResponse = await axios.post(
    `${GRAPH_API_URL}/${instagramAccountId}/media_publish`,
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

export async function refreshLongLivedToken(currentToken) {
  const { saveToken, getToken } = await import('../db.js');

  const response = await axios.get(`${GRAPH_API_URL}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      fb_exchange_token: currentToken
    }
  });

  const existing = getToken();
  if (existing) {
    saveToken({
      instagramAccountId: existing.instagram_account_id,
      accessToken: response.data.access_token,
      pageAccessToken: existing.page_access_token,
      username: existing.username,
      expiresAt: Date.now() + (response.data.expires_in * 1000)
    });
  }

  return response.data;
}

export async function getUserProfile(accessToken, instagramAccountId) {
  const response = await axios.get(`${GRAPH_API_URL}/${instagramAccountId}`, {
    params: {
      fields: 'username,profile_picture_url,name',
      access_token: accessToken
    }
  });

  return response.data;
}
