import { useState, useEffect } from 'react';
import ContextInput from './components/ContextInput';
import GenerationStatus from './components/GenerationStatus';
import ReelPreview from './components/ReelPreview';
import InstagramLogin from './components/InstagramLogin';
import QuickIdea from './components/QuickIdea';
import IdeaQueue from './components/IdeaQueue';
import CharacterRef from './components/CharacterRef';
import {
  generateScript,
  generateAudio,
  generateVideo,
  getAvailableVoices,
  getSession,
  logout,
  postToInstagram
} from './services/api';
import './App.css';

function App() {
  const [tab, setTab] = useState('quick'); // 'quick' | 'queue' | 'studio'
  const [voices, setVoices] = useState(['rachel', 'josh', 'bella', 'adam', 'arnold']);
  const [user, setUser] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [reelData, setReelData] = useState(null);
  const [generationStatus, setGenerationStatus] = useState({
    isGenerating: false,
    currentStep: null,
    error: null
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    const error = params.get('error');

    if (session) {
      setSessionId(session);
      localStorage.setItem('instagram_session', session);
      window.history.replaceState({}, '', '/');
      loadSession(session);
    } else if (error) {
      alert(`Login error: ${error}`);
      window.history.replaceState({}, '', '/');
    } else {
      const storedSession = localStorage.getItem('instagram_session');
      if (storedSession) {
        setSessionId(storedSession);
        loadSession(storedSession);
      }
    }

    loadVoices();
  }, []);

  const loadVoices = async () => {
    try {
      const data = await getAvailableVoices();
      setVoices(data.voices);
    } catch (err) {
      console.error('Failed to load voices:', err);
    }
  };

  const loadSession = async (sid) => {
    try {
      const data = await getSession(sid);
      setUser(data.profile);
    } catch (err) {
      console.error('Session invalid:', err);
      localStorage.removeItem('instagram_session');
      setSessionId(null);
    }
  };

  const handleLogout = async () => {
    if (sessionId) {
      try {
        await logout(sessionId);
      } catch (err) {
        console.error('Logout error:', err);
      }
    }
    localStorage.removeItem('instagram_session');
    setSessionId(null);
    setUser(null);
  };

  const handleGenerate = async (context, voice) => {
    setReelData(null);
    setGenerationStatus({
      isGenerating: true,
      currentStep: 'script',
      error: null
    });

    try {
      const content = await generateScript(context);
      setGenerationStatus(s => ({ ...s, currentStep: 'audio' }));

      const audio = await generateAudio(content.script, voice);
      setGenerationStatus(s => ({ ...s, currentStep: 'video' }));

      const video = await generateVideo(content.videoPrompt);
      setGenerationStatus(s => ({ ...s, currentStep: 'combining' }));

      setGenerationStatus({
        isGenerating: false,
        currentStep: 'complete',
        error: null
      });

      setReelData({
        content,
        audio,
        video,
        finalVideo: video
      });

    } catch (error) {
      setGenerationStatus(s => ({
        ...s,
        isGenerating: false,
        error: error.message
      }));
    }
  };

  const handlePost = async () => {
    if (!sessionId) {
      alert('Please connect your Instagram account first');
      return;
    }

    if (!reelData) {
      alert('No reel to post');
      return;
    }

    try {
      const caption = `${reelData.content.caption}\n\n${reelData.content.hashtags.map(t => `#${t}`).join(' ')}`;
      const videoUrl = reelData.finalVideo?.url || reelData.video?.url;

      const result = await postToInstagram(sessionId, videoUrl, caption);
      alert('Reel posted successfully!');
      console.log('Post result:', result);
    } catch (error) {
      alert(`Failed to post: ${error.message}`);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Reel Engine</h1>
        <p className="header-subtitle">AI-powered Instagram content</p>
        <InstagramLogin user={user} onLogout={handleLogout} />
      </header>

      <CharacterRef />

      <nav className="tab-nav">
        <button
          className={`tab-btn ${tab === 'quick' ? 'active' : ''}`}
          onClick={() => setTab('quick')}
        >Quick Idea</button>
        <button
          className={`tab-btn ${tab === 'queue' ? 'active' : ''}`}
          onClick={() => setTab('queue')}
        >Queue</button>
        <button
          className={`tab-btn ${tab === 'studio' ? 'active' : ''}`}
          onClick={() => setTab('studio')}
        >Studio</button>
      </nav>

      <main className="main">
        {tab === 'quick' && (
          <section className="input-section">
            <QuickIdea />
          </section>
        )}

        {tab === 'queue' && (
          <section className="queue-section">
            <IdeaQueue />
          </section>
        )}

        {tab === 'studio' && (
          <>
            <section className="input-section">
              <ContextInput
                onGenerate={handleGenerate}
                isGenerating={generationStatus.isGenerating}
                voices={voices}
              />
            </section>

            <section className="status-section">
              <GenerationStatus status={generationStatus} />
            </section>

            <section className="preview-section">
              <ReelPreview reelData={reelData} onPost={handlePost} />
            </section>
          </>
        )}
      </main>

      <footer className="footer">
        <p>Powered by OpenAI, Grok xAI, FLUX, and Meta Graph API</p>
      </footer>
    </div>
  );
}

export default App;
