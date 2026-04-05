import { useState } from 'react';
import { addIdea } from '../services/api';

function QuickIdea() {
  const [prompt, setPrompt] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setSubmitting(true);
    try {
      const idea = await addIdea(prompt.trim(), scheduledDate || undefined);
      setToast({ type: 'success', message: `Queued for ${idea.scheduled_date}` });
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
      <h2>What's your reel idea?</h2>
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
