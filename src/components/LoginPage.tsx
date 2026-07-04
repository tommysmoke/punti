import type { FC, FormEvent } from 'react'

type LoginPageProps = {
  loginIdentifier: string
  onLoginIdentifierChange: (value: string) => void
  loginPassword: string
  onLoginPasswordChange: (value: string) => void
  loginError: string
  loginLoading: boolean
  visiblePasswords: Record<string, boolean>
  onTogglePasswordVisibility: (field: string) => void
  onLogin: (event: FormEvent) => void
}

export const LoginPage: FC<LoginPageProps> = ({
  loginIdentifier,
  onLoginIdentifierChange,
  loginPassword,
  onLoginPasswordChange,
  loginError,
  loginLoading,
  visiblePasswords,
  onTogglePasswordVisibility,
  onLogin,
}) => {
  return (
    <main className="app-shell auth-layout">
      <section className="card auth-card auth-card-polished">
        <div className="auth-hero-row">
          <h1 className="auth-hero-title" aria-label="Tommy Smoke Raccolta Punti">
            <span className="auth-hero-word auth-hero-fill">Tommy</span>
            <span className="auth-hero-word auth-hero-fill">Smoke</span>
            <span className="auth-hero-word">Raccolta</span>
            <span className="auth-hero-word">Punti</span>
          </h1>
          <img
            className="auth-logo"
            src={`${import.meta.env.BASE_URL}favicon-192x192.png`}
            alt="Logo Tommy Smoke"
          />
        </div>
        <p className="hint no-top">Accedi con il tuo username per continuare.</p>

        <form className="stack" onSubmit={onLogin}>
          <label>
            Username
            <input
              type="text"
              value={loginIdentifier}
              onChange={(event) => onLoginIdentifierChange(event.target.value)}
              placeholder="es. MarioRossi80"
            />
          </label>
          <label>
            Password
            <div className="password-row">
              <input
                type={visiblePasswords.login ? 'text' : 'password'}
                value={loginPassword}
                onChange={(event) => onLoginPasswordChange(event.target.value)}
                placeholder="Inserisci password"
              />
              <button
                className="ghost small"
                type="button"
                onClick={() => onTogglePasswordVisibility('login')}
                aria-label={visiblePasswords.login ? 'Nascondi password' : 'Mostra password'}
              >
                {visiblePasswords.login ? 'Nascondi' : 'Mostra'}
              </button>
            </div>
          </label>
          {loginError ? <p className="error">{loginError}</p> : null}
          <button className="cta" type="submit" disabled={loginLoading}>
            {loginLoading ? 'Accesso in corso...' : 'Accedi'}
          </button>
        </form>

        <p className="privacy-note">
          <span className="privacy-note-icon" aria-hidden="true">🛡️</span>
          I tuoi dati personali non vengono condivisi con nessuno. Utilizziamo i tuoi dati solo per la raccolta punti. Non raccogliamo cookies.
        </p>
      </section>
    </main>
  )
}
