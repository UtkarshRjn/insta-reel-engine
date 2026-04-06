import { useState, useEffect, useRef } from 'react';
import { getIdeas, deleteIdea, retryIdea, generatePreview, postIdeaToInstagram } from '../services/api';

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
  const pollRef = useRef(null);

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

  // Poll when any idea is generating
  useEffect(() => {
    const hasGenerating = ideas.some(i => i.preview_status === 'generating' || i.status === 'processing');
    if (hasGenerating && !pollRef.current) {
      pollRef.current = setInterval(loadIdeas, 5000);
    } else if (!hasGenerating && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [ideas]);

  const handleDelete = async (id) => {
    try {
      await deleteIdea(id);
      setIdeas(ideas.filter(i => i.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleGeneratePreview = async (id) => {
    try {
      await generatePreview(id);
      loadIdeas();
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePostToInstagram = async (id) => {
    try {
      await postIdeaToInstagram(id);
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

  const parsePreviewUrls = (urlsJson) => {
    try {
      return JSON.parse(urlsJson) || [];
    } catch {
      return [];
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
          {ideas.map(idea => {
            const previewUrls = parsePreviewUrls(idea.preview_urls);
            const isImage = idea.media_type === 'image';

            return (
              <div key={idea.id} className="queue-item">
                <div className="queue-item-main">
                  <span
                    className="status-badge"
                    style={{ backgroundColor: STATUS_COLORS[idea.status] }}
                  >
                    {idea.status}
                  </span>
                  <span className="queue-date">{idea.scheduled_date}</span>
                  <span className="queue-model">
                    {isImage ? `IMG` : 'VID'}
                    {isImage && idea.image_count > 1 ? ` x${idea.image_count}` : ''}
                    {' '}&middot; {idea.model || 'grok'}
                  </span>
                  <p className="queue-prompt">{idea.prompt}</p>
                </div>

                {/* Preview thumbnails */}
                {previewUrls.length > 0 && (
                  <div className="preview-thumbnails">
                    {previewUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt={`Preview ${i + 1}`} className="preview-thumb" />
                      </a>
                    ))}
                  </div>
                )}

                {/* Caption preview */}
                {idea.caption && idea.preview_status === 'ready' && (
                  <div className="queue-caption-preview">
                    {idea.caption.substring(0, 120)}{idea.caption.length > 120 ? '...' : ''}
                  </div>
                )}

                {/* Generating spinner */}
                {idea.preview_status === 'generating' && (
                  <div className="queue-generating">
                    <div className="spinner"></div>
                    <span>Generating {idea.image_count || 1} image{(idea.image_count || 1) > 1 ? 's' : ''}...</span>
                  </div>
                )}

                {/* Actions */}
                <div className="queue-item-actions">
                  {idea.status === 'pending' && (
                    <>
                      {/* No preview yet */}
                      {!idea.preview_status && isImage && (
                        <button className="btn-small btn-primary" onClick={() => handleGeneratePreview(idea.id)}>
                          Generate Preview
                        </button>
                      )}

                      {/* Preview ready */}
                      {idea.preview_status === 'ready' && (
                        <>
                          <button className="btn-small btn-success" onClick={() => handlePostToInstagram(idea.id)}>
                            Post to Instagram
                          </button>
                          <button className="btn-small btn-outline" onClick={() => handleGeneratePreview(idea.id)}>
                            Regenerate
                          </button>
                        </>
                      )}

                      {/* Preview failed */}
                      {idea.preview_status === 'failed' && (
                        <button className="btn-small btn-primary" onClick={() => handleGeneratePreview(idea.id)}>
                          Retry Preview
                        </button>
                      )}

                      {/* Video ideas — keep direct post */}
                      {!isImage && (
                        <button className="btn-small btn-primary" onClick={() => handleGeneratePreview(idea.id)}>
                          Generate Preview
                        </button>
                      )}

                      <button className="btn-small btn-danger" onClick={() => handleDelete(idea.id)}>
                        Remove
                      </button>
                    </>
                  )}

                  {idea.status === 'processing' && (
                    <button className="btn-small btn-outline" disabled>
                      Posting...
                    </button>
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
            );
          })}
        </div>
      )}

      <button className="btn-small btn-outline refresh-btn" onClick={loadIdeas}>
        Refresh
      </button>
    </div>
  );
}

export default IdeaQueue;
