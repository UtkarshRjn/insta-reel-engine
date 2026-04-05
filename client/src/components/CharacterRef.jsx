import { useState, useEffect, useRef } from 'react';
import { getRefImage, uploadRefImage, removeRefImage } from '../services/api';

function CharacterRef() {
  const [refImage, setRefImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadRef();
  }, []);

  const loadRef = async () => {
    try {
      const data = await getRefImage();
      if (data && data.url) setRefImage(data);
    } catch (err) {
      console.error('Failed to load ref image:', err);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'Please upload an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('error', 'Image must be under 10MB');
      return;
    }

    setUploading(true);
    try {
      const data = await uploadRefImage(file);
      setRefImage(data);
      showToast('success', 'Reference image updated');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    try {
      await removeRefImage();
      setRefImage(null);
      showToast('success', 'Reference image removed');
    } catch (err) {
      showToast('error', err.message);
    }
  };

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleUpload(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  return (
    <div className="char-ref">
      <div className="char-ref-header">
        <h2>Character Reference</h2>
        <p className="char-ref-desc">Upload a reference photo to keep your AI character consistent across all posts</p>
      </div>

      {refImage ? (
        <div className="char-ref-preview">
          <div className="char-ref-image-wrap">
            <img src={refImage.url} alt="Character reference" className="char-ref-image" />
            <div className="char-ref-overlay">
              <button
                className="btn-small btn-outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                Replace
              </button>
              <button
                className="btn-small btn-danger"
                onClick={handleRemove}
              >
                Remove
              </button>
            </div>
          </div>
          <div className="char-ref-info">
            <span className="char-ref-active">Active</span>
            <span className="char-ref-name">{refImage.name || 'character-ref.png'}</span>
          </div>
        </div>
      ) : (
        <div
          className={`char-ref-dropzone ${dragOver ? 'drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(false)}
        >
          <div className="dropzone-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p className="dropzone-text">
            {uploading ? 'Uploading...' : 'Drop an image here or click to browse'}
          </p>
          <p className="dropzone-hint">PNG or JPG, max 10MB</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(e) => {
          handleUpload(e.target.files[0]);
          e.target.value = '';
        }}
      />

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default CharacterRef;
