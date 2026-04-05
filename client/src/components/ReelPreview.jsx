export default function ReelPreview({ reelData, onPost }) {
  if (!reelData) return null;

  const { content, finalVideo } = reelData;
  const videoUrl = `http://localhost:3001${finalVideo?.url || reelData.video?.url}`;

  return (
    <div className="reel-preview">
      <h3>Your Reel is Ready!</h3>

      <div className="preview-container">
        <div className="video-wrapper">
          <video
            src={videoUrl}
            controls
            autoPlay
            loop
            muted
          />
        </div>

        <div className="reel-details">
          <div className="detail-section">
            <h4>Script</h4>
            <p>{content?.script}</p>
          </div>

          <div className="detail-section">
            <h4>Caption</h4>
            <p>{content?.caption}</p>
          </div>

          <div className="detail-section">
            <h4>Hashtags</h4>
            <div className="hashtags">
              {content?.hashtags?.map((tag, i) => (
                <span key={i} className="hashtag">#{tag}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="preview-actions">
        <a
          href={videoUrl}
          download="reel.mp4"
          className="btn btn-secondary"
        >
          Download Video
        </a>
        <button onClick={onPost} className="btn btn-primary">
          Post to Instagram
        </button>
      </div>
    </div>
  );
}
