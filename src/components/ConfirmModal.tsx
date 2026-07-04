import type { FC } from 'react'

type ConfirmAction =
  | 'redeem'
  | 'override'
  | 'delete-transaction'
  | 'delete-customer'
  | 'delete-reward'
  | 'create-duplicate-customer'

type ConfirmModalState = {
  action: ConfirmAction
  message: string
  transactionId?: number
  customerId?: number
  rewardId?: number
}

type ConfirmModalProps = {
  modal: ConfirmModalState
  isProcessing: boolean
  onClose: () => void
  onConfirm: (action: ConfirmAction) => void
}

export const ConfirmModal: FC<ConfirmModalProps> = ({ modal, isProcessing, onClose, onConfirm }) => {
  const handleOverlayClick = () => {
    if (!isProcessing) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Conferma operazione</h3>
        <p>{modal.message}</p>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose} disabled={isProcessing}>
            Annulla
          </button>
          <button
            className="cta"
            disabled={isProcessing}
            onClick={() => onConfirm(modal.action)}
          >
            Conferma
          </button>
        </div>
      </div>
    </div>
  )
}

export type { ConfirmAction, ConfirmModalState }
