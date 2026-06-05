import { clamp, formatStepState } from '../utils/formatters';

export default function ProgressStepper({ steps = [], progress = 0 }) {
  const percent = clamp(progress, 0, 100);

  return (
    <section className="panel">
      <div className="panel__inner stepper">
        <div className="panel__heading">
          <div>
            <h3>Provisioning Progress</h3>
            <p>The backend is provisioning Azure access in a fixed sequence.</p>
          </div>
          <span className="helper-badge">{Math.round(percent)}%</span>
        </div>

        <div className="progress-track" aria-label="Provisioning progress">
          <div className="progress-track__fill" style={{ width: `${percent}%` }} />
        </div>

        <div className="step-list">
          {steps.map((step) => (
            <article className="step-card" key={step.key} data-state={step.state || 'pending'}>
              <div>
                <h4 className="step-card__title">{step.title}</h4>
                <p className="step-card__desc">{step.description}</p>
              </div>
              <span className="step-card__indicator">{formatStepState(step.state)}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
