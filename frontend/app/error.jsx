'use client';

export default function Error({ error, reset }) {
  return (
    <main className="app-shell page-shell">
      <section className="error-card">
        <h1 className="error-card__title">Something went wrong</h1>
        <p className="error-card__text">{error?.message || 'The portal failed to load.'}</p>
        <div className="button-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--primary" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
