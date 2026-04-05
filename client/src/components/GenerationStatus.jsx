export default function GenerationStatus({ status }) {
  const steps = [
    { key: 'script', label: 'Generating Script', icon: '📝' },
    { key: 'audio', label: 'Creating Voiceover', icon: '🎙️' },
    { key: 'video', label: 'Generating Video', icon: '🎬' },
    { key: 'combining', label: 'Combining Media', icon: '🔧' },
    { key: 'complete', label: 'Complete', icon: '✅' }
  ];

  const getStepStatus = (stepKey) => {
    const stepOrder = ['script', 'audio', 'video', 'combining', 'complete'];
    const currentIndex = stepOrder.indexOf(status.currentStep);
    const stepIndex = stepOrder.indexOf(stepKey);

    if (status.error) {
      if (stepIndex === currentIndex) return 'error';
      if (stepIndex < currentIndex) return 'completed';
      return 'pending';
    }

    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'pending';
  };

  if (!status.isGenerating && !status.currentStep) {
    return null;
  }

  return (
    <div className="generation-status">
      <h3>Generation Progress</h3>
      <div className="steps">
        {steps.map((step) => (
          <div key={step.key} className={`step ${getStepStatus(step.key)}`}>
            <span className="step-icon">{step.icon}</span>
            <span className="step-label">{step.label}</span>
            {getStepStatus(step.key) === 'active' && (
              <span className="spinner"></span>
            )}
            {getStepStatus(step.key) === 'completed' && (
              <span className="check">✓</span>
            )}
            {getStepStatus(step.key) === 'error' && (
              <span className="error-icon">✗</span>
            )}
          </div>
        ))}
      </div>
      {status.error && (
        <div className="error-message">
          Error: {status.error}
        </div>
      )}
    </div>
  );
}
