export default function Home() {
  return <main className="welcome-page">
    <header className="welcome-header">
      <a className="brand" href="/" aria-label="Smart Healthcare home"><span className="brand-mark" aria-hidden="true">＋</span> Smart Healthcare</a>
      <nav aria-label="Main navigation">
        <a href="#care">Our care</a>
        <a href="#how-it-works">How it works</a>
        <a className="nav-signin" href="/signin">Sign in</a>
      </nav>
    </header>

    <section className="welcome-hero" aria-labelledby="welcome-title">
      <div className="hero-copy">
        <p className="eyebrow">CARE THAT CONNECTS</p>
        <h1 id="welcome-title">Your health, <span>in good hands.</span></h1>
        <p className="hero-description">A simpler way to connect with your care team, manage appointments and keep your health journey organized.</p>
        <div className="hero-actions">
          <a className="primary-button hero-cta" href="/signup">Create a patient account <span aria-hidden="true">→</span></a>
          <a className="hero-secondary" href="#care">Explore the platform</a>
        </div>
        <div className="hero-note"><span className="note-check" aria-hidden="true">✓</span> Private, secure access to your care</div>
      </div>
      <div className="hero-art" aria-label="Illustration of a care team and appointment card" role="img">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="art-card appointment-art"><span className="art-label">YOUR NEXT VISIT</span><strong>Care, made easier.</strong><span className="art-line" /><span className="art-line short" /><span className="art-pill"><span /> Connected care</span></div>
        <div className="art-person person-one"><span className="person-head" /><span className="person-body" /></div>
        <div className="art-person person-two"><span className="person-head" /><span className="person-body" /></div>
        <div className="art-spark spark-one">✦</div><div className="art-spark spark-two">✧</div>
      </div>
    </section>

    <section className="care-section" id="care" aria-labelledby="care-title">
      <div className="section-intro"><p className="eyebrow">CARE, WITHOUT THE FRICTION</p><h2 id="care-title">Everything you need to stay connected</h2><p>Helpful tools for patients and clinicians, all in one place.</p></div>
      <div className="care-cards">
        <article className="care-card"><span className="feature-icon calendar-icon" aria-hidden="true">▦</span><h3>Appointments that fit</h3><p>Find available care and keep track of upcoming visits in one convenient place.</p></article>
        <article className="care-card"><span className="feature-icon records-icon" aria-hidden="true">♡</span><h3>Your health, organized</h3><p>Access your profile and authorized consultation records when you need them.</p></article>
        <article className="care-card"><span className="feature-icon team-icon" aria-hidden="true">✳</span><h3>A team that’s in sync</h3><p>Stay up to date with clear notifications from your care team.</p></article>
      </div>
    </section>

    <section className="account-section" id="how-it-works" aria-labelledby="next-step-title">
      <div className="account-copy">
        <p className="eyebrow">A BETTER WAY TO MANAGE CARE</p>
        <h2 id="next-step-title">One place for your next step.</h2>
        <p>Create a patient account to complete your profile, find an approved doctor and manage your appointments.</p>
        <ul><li><span>01</span> Create your secure patient account</li><li><span>02</span> Complete your profile</li><li><span>03</span> Connect with the right care</li></ul>
      </div>
      <div className="auth-card home-auth-links">
        <h2>Ready to continue?</h2>
        <p className="auth-intro">Sign in to your workspace or create a patient account to get started.</p>
        <a className="primary-button auth-submit" href="/signin">Sign in securely <span aria-hidden="true">→</span></a>
        <a className="secondary-button auth-submit" href="/signup">Create a patient account</a>
      </div>
    </section>

    <footer className="welcome-footer"><a className="brand" href="/"> <span className="brand-mark" aria-hidden="true">＋</span> Smart Healthcare</a><span>Thoughtful care, connected.</span><span>© 2026 Smart Healthcare</span></footer>
  </main>;
}
