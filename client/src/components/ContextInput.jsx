import { useState } from 'react';

export default function ContextInput({ onGenerate, isGenerating, voices }) {
  const [context, setContext] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('rachel');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (context.trim() && !isGenerating) {
      onGenerate(context, selectedVoice);
    }
  };

  return (
    <div className="context-input">
      <h2>Create Your Reel</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="context">What's your reel about?</label>
          <textarea
            id="context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Describe your reel idea... e.g., 'A motivational message about never giving up on your dreams, with cinematic visuals of someone climbing a mountain'"
            rows={5}
            disabled={isGenerating}
          />
        </div>

        <div className="form-group">
          <label htmlFor="voice">Voiceover Style</label>
          <select
            id="voice"
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            disabled={isGenerating}
          >
            {voices.map((voice) => (
              <option key={voice} value={voice}>
                {voice.charAt(0).toUpperCase() + voice.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={!context.trim() || isGenerating}>
          {isGenerating ? 'Generating...' : 'Generate Reel'}
        </button>
      </form>
    </div>
  );
}
