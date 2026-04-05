const API_URL = 'http://localhost:3001/api';

export async function generateScript(context) {
  const response = await fetch(`${API_URL}/generate/script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function generateAudio(script, voice = 'rachel') {
  const response = await fetch(`${API_URL}/generate/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script, voice })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function generateVideo(prompt, duration = 4) {
  const response = await fetch(`${API_URL}/generate/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, duration })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function generateFullReel(context, voice = 'rachel', videoDuration = 4) {
  const response = await fetch(`${API_URL}/generate/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, voice, videoDuration })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getAvailableVoices() {
  const response = await fetch(`${API_URL}/generate/voices`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getSession(sessionId) {
  const response = await fetch(`${API_URL}/auth/session/${sessionId}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function logout(sessionId) {
  const response = await fetch(`${API_URL}/auth/logout/${sessionId}`, {
    method: 'POST'
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function postToInstagram(sessionId, videoUrl, caption) {
  const response = await fetch(`${API_URL}/instagram/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, videoUrl, caption })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function getInstagramLoginUrl() {
  return `${API_URL}/auth/instagram`;
}

// --- Queue API ---

export async function addIdea(prompt, scheduledDate) {
  const body = { prompt };
  if (scheduledDate) body.scheduledDate = scheduledDate;

  const response = await fetch(`${API_URL}/queue/ideas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getIdeas(status) {
  const url = status
    ? `${API_URL}/queue/ideas?status=${status}`
    : `${API_URL}/queue/ideas`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function deleteIdea(id) {
  const response = await fetch(`${API_URL}/queue/ideas/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function retryIdea(id) {
  const response = await fetch(`${API_URL}/queue/ideas/${id}/retry`, {
    method: 'POST'
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
