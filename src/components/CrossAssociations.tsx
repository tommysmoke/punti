type Props = {
  onBack: () => void
}

function CrossAssociations({ onBack }: Props) {
  return (
    <section className="store-single-page">
      <article className="card">
        <h2>Correzioni associazioni</h2>
        <p className="hint no-top" style={{ marginBottom: '1rem' }}>
          Questa sezione è in preparazione.
        </p>
        <button className="ghost small" type="button" onClick={onBack}>
          Torna a Cross-Inventory
        </button>
      </article>
    </section>
  )
}

export default CrossAssociations
