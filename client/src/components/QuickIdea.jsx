import { useState } from 'react';
import { addIdea } from '../services/api';

const MODEL_OPTIONS = {
  video: [
    { value: 'grok', label: 'Grok xAI' },
    { value: 'kling', label: 'Kling 3.0 (fal.ai)' }
  ],
  image: [
    { value: 'grok', label: 'Grok Imagine' },
    { value: 'flux', label: 'FLUX Kontext (fal.ai)' }
  ]
};

function QuickIdea() {
  const [prompt, setPrompt] = useState('');
  const [mediaType, setMediaType] = useState('video');
  const [model, setModel] = useState('grok');
  const [scheduledDate, setScheduledDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const handleMediaTypeChange = (type) => {
    setMediaType(type);
    // Reset model to first option for this type
    setModel(MODEL_OPTIONS[type][0].value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setSubmitting(true);
    try {
      const idea = await addIdea(prompt.trim(), scheduledDate || undefined, mediaType, model);
      setToast({ type: 'success', message: `Queued for ${idea.scheduled_date} (${model})` });
      setPrompt('');
      setScheduledDate('');
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast({ type: 'error', message: err.message });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="quick-idea">
      <h2>What's your idea?</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A satisfying time-lapse of a city skyline at sunset with chill lo-fi vibes..."
            rows={4}
            disabled={submitting}
          />
        </div>
        <div className="form-group">
          <label>Type</label>
          <div className="media-toggle">
            <button
              type="button"
              className={`toggle-btn ${mediaType === 'video' ? 'active' : ''}`}
              onClick={() => handleMediaTypeChange('video')}
            >Video (Reel)</button>
            <button
              type="button"
              className={`toggle-btn ${mediaType === 'image' ? 'active' : ''}`}
              onClick={() => handleMediaTypeChange('image')}
            >Image (Post)</button>
          </div>
        </div>
        <div className="form-group">
          <label>Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={submitting}
          >
            {MODEL_OPTIONS[mediaType].map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Schedule for (optional)</label>
          <input
            type="date"
            className="date-input"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
            disabled={submitting}
          />
        </div>
        <button type="submit" disabled={submitting || !prompt.trim()}>
          {submitting ? 'Queueing...' : 'Queue It'}
        </button>
      </form>

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default QuickIdea;
