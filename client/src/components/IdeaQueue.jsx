import { useState, useEffect } from 'react';
import { getIdeas, deleteIdea, retryIdea, postIdeaNow } from '../services/api';

const STATUS_COLORS = {
  pending: '#f59e0b',
  processing: '#3b82f6',
  completed: '#4ade80',
  failed: '#ef4444'
};

function IdeaQueue() {
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(null);

  const loadIdeas = async () => {
    try {
      const data = await getIdeas(filter);
      setIdeas(data);
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIdeas();
  }, [filter]);

  const handleDelete = async (id) => {
    try {
      await deleteIdea(id);
      setIdeas(ideas.filter(i => i.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePostNow = async (id) => {
    try {
      await postIdeaNow(id);
      loadIdeas();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRetry = async (id) => {
    try {
      await retryIdea(id);
      loadIdeas();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return <div className="queue-loading">Loading queue...</div>;
  }

  return (
    <div className="idea-queue">
      <div className="queue-header">
        <h2>Idea Queue</h2>
        <div className="queue-filters">
          <button
            className={`filter-btn ${filter === null ? 'active' : ''}`}
            onClick={() => setFilter(null)}
          >All</button>
          <button
            className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >Pending</button>
          <button
            className={`filter-btn ${filter === 'completed' ? 'active' : ''}`}
            onClick={() => setFilter('completed')}
          >Posted</button>
          <button
            className={`filter-btn ${filter === 'failed' ? 'active' : ''}`}
            onClick={() => setFilter('failed')}
          >Failed</button>
        </div>
      </div>

      {ideas.length === 0 ? (
        <div className="queue-empty">
          <div className="queue-empty-icon">~</div>
          <p>No ideas yet. Add one in Quick Idea!</p>
        </div>
      ) : (
        <div className="queue-list">
          {ideas.map(idea => (
            <div key={idea.id} className="queue-item">
              <div className="queue-item-main">
                <span
                  className="status-badge"
                  style={{ backgroundColor: STATUS_COLORS[idea.status] }}
                >
                  {idea.status}
                </span>
                <span className="queue-date">{idea.scheduled_date}</span>
                <span className="queue-model">{idea.media_type === 'image' ? 'IMG' : 'VID'} · {idea.model || 'grok'}</span>
                <p className="queue-prompt">{idea.prompt}</p>
              </div>
              <div className="queue-item-actions">
                {idea.status === 'pending' && (
                  <>
                    <button className="btn-small btn-primary" onClick={() => handlePostNow(idea.id)}>
                      Post Now
                    </button>
                    <button className="btn-small btn-danger" onClick={() => handleDelete(idea.id)}>
                      Remove
                    </button>
                  </>
                )}
                {idea.status === 'failed' && (
                  <button className="btn-small btn-outline" onClick={() => handleRetry(idea.id)}>
                    Retry
                  </button>
                )}
              </div>
              {idea.error && (
                <div className="queue-item-error">{idea.error}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <button className="btn-small btn-outline refresh-btn" onClick={loadIdeas}>
        Refresh
      </button>
    </div>
  );
}

export default IdeaQueue;
