import { Modal } from '@heroui-v3/react'
import ConnectionDetailModal from '@renderer/components/connections/connection-detail-modal'
import ConnectionItem from '@renderer/components/connections/connection-item'
import { mihomoCloseConnection } from '@renderer/utils/ipc'
import React, { useState } from 'react'

interface Props {
  title: string
  conns: ControllerConnectionDetail[]
  hideProcess?: boolean
  iconUrl?: string
  onClose: () => void
}

const LiveConnsModal: React.FC<Props> = ({ title, conns, hideProcess, iconUrl, onClose }) => {
  const [selected, setSelected] = useState<ControllerConnectionDetail>()
  const [detailOpen, setDetailOpen] = useState(false)

  return (
    <>
      <Modal>
        <Modal.Backdrop
          isOpen={true}
          onOpenChange={onClose}
          variant="blur"
          className="top-12 h-[calc(100%-48px)]"
        >
          <Modal.Container scroll="inside">
            <Modal.Dialog className="w-[min(640px,calc(100%-24px))] max-w-none pb-2 flag-emoji">
              <Modal.Header className="app-drag pb-0">
                <Modal.Heading>
                  {title} · {conns.length} 活跃连接
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="min-h-0 overflow-y-auto max-h-[min(60vh,560px)] px-0 pt-2 pb-1">
                {conns.length === 0 ? (
                  <div className="text-center text-sm text-foreground-500 py-6">
                    连接已全部断开
                  </div>
                ) : (
                  conns.map((conn, i) => (
                    <ConnectionItem
                      key={conn.id}
                      index={i}
                      info={conn}
                      iconUrl={iconUrl ?? ''}
                      displayIcon={!!iconUrl}
                      hideProcess={hideProcess}
                      selected={selected}
                      setSelected={setSelected}
                      setIsDetailModalOpen={setDetailOpen}
                      close={(id) => void mihomoCloseConnection(id)}
                    />
                  ))
                )}
              </Modal.Body>
              <Modal.CloseTrigger className="app-nodrag" />
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {detailOpen && selected && (
        <ConnectionDetailModal connection={selected} onClose={() => setDetailOpen(false)} />
      )}
    </>
  )
}

export default LiveConnsModal
