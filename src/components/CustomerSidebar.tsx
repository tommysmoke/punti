import type { FC } from 'react'

type Customer = {
  id: number
  store_id: string
  name: string
  phone: string
  points: number
  birth_day_month: string | null
  username: string | null
  notes: string | null
}

type CustomerSidebarProps = {
  customers: Customer[]
  customerSearch: string
  onCustomerSearchChange: (value: string) => void
  selectedStoreCustomerId: number | null
  onSelectCustomer: (id: number) => void
  loadingData: boolean
}

export const CustomerSidebar: FC<CustomerSidebarProps> = ({
  customers,
  customerSearch,
  onCustomerSearchChange,
  selectedStoreCustomerId,
  onSelectCustomer,
  loadingData,
}) => {
  return (
    <article className="card customers-sidebar">
      <h2>Clienti <span className="badge">{customers.length}</span></h2>
      <label>
        Cerca cliente
        <input
          type="text"
          value={customerSearch}
          onChange={(event) => onCustomerSearchChange(event.target.value)}
          placeholder="Nome o telefono"
        />
      </label>
      {loadingData ? (
        <div className="skeleton-list" aria-hidden="true">
          <div className="skeleton-box skeleton-customer"></div>
          <div className="skeleton-box skeleton-customer"></div>
          <div className="skeleton-box skeleton-customer"></div>
          <div className="skeleton-box skeleton-customer"></div>
        </div>
      ) : (
        <ul className="customer-list">
          {customers.length ? (
            customers.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  className={`customer-item ${selectedStoreCustomerId === customer.id ? 'active' : ''}`}
                  onClick={() => onSelectCustomer(customer.id)}
                >
                  <span>{customer.name}</span>
                  <strong>{customer.points} pt</strong>
                </button>
              </li>
            ))
          ) : (
            <li className="hint no-top">Nessun cliente corrisponde alla ricerca</li>
          )}
        </ul>
      )}
    </article>
  )
}

export type { Customer }
