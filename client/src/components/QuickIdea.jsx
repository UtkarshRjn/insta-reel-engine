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

// FLUX-supported ratios that also satisfy Instagram's 0.8–1.91 feed constraint
const FLUX_ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 (Square — recommended for carousels)' },
  { value: '4:3', label: '4:3 (Landscape)' },
  { value: '3:2', label: '3:2 (Landscape)' },
  { value: '16:9', label: '16:9 (Wide)' }
];

function QuickIdea() {
  const [prompt, setPrompt] = useState('');
  const [mediaType, setMediaType] = useState('video');
  const [model, setModel] = useState('grok');
  const [imageCount, setImageCount] = useState(1);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [scheduledDate, setScheduledDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const handleMediaTypeChange = (type) => {
    setMediaType(type);
    setModel(MODEL_OPTIONS[type][0].value);
    if (type === 'video') setImageCount(1);
  };

  const showAspectRatio = mediaType === 'image' && model === 'flux';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setSubmitting(true);
    try {
      const ratioToSend = showAspectRatio ? aspectRatio : null;
      const idea = await addIdea(prompt.trim(), scheduledDate || undefined, mediaType, model, imageCount, ratioToSend);
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
        {mediaType === 'image' && (
          <div className="form-group">
            <label>Number of Images</label>
            <div className="image-count-selector">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`count-btn ${imageCount === n ? 'active' : ''}`}
                  onClick={() => setImageCount(n)}
                  disabled={submitting}
                >{n}</button>
              ))}
            </div>
          </div>
        )}
        {showAspectRatio && (
          <div className="form-group">
            <label>Aspect Ratio</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              disabled={submitting}
            >
              {FLUX_ASPECT_RATIOS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
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
