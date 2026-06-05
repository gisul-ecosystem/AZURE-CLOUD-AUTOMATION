import { formatDateTime } from '../utils/formatters';

export default function RequestTimeline({ title = 'Request Timeline', description = '', events = [] }) {
  return (
    <section className="panel">
      <div className="panel__inner">
        <div className="panel__heading">
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
        </div>

        <ol className="timeline-list">
          {events.length > 0 ? (
            events.map((event, index) => (
              <li className={`timeline-item timeline-item--${event.kind || 'info'}`} key={`${event.message}-${index}`}>
                <div className="timeline-item__heading">
                  <strong>{event.title || event.message}</strong>
                  <span className="timeline-item__time">
                    {event.timestamp ? formatDateTime(event.timestamp) : ''}
                  </span>
                </div>
                <span className="timeline-item__meta">{event.message}</span>
              </li>
            ))
          ) : (
            <li className="timeline-item">
              <strong>No events yet</strong>
              <span className="timeline-item__meta">
                The workflow will populate this list as provisioning advances.
              </span>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}
