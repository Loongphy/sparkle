import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { FaCircleArrowDown, FaCircleArrowUp } from 'react-icons/fa6'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic } from '@renderer/utils/calc'
import { getTrafficStatsSummary } from '@renderer/utils/ipc'
import { STATS_RANGE_LABELS, STATS_REFRESH_INTERVAL } from '@renderer/utils/stats'
import React, { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IoStatsChart } from 'react-icons/io5'
import { useAppConfig } from '@renderer/hooks/use-app-config'

interface Props {
  iconOnly?: boolean
}

const StatsCard: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const { appConfig } = useAppConfig()
  const {
    statsCardStatus = 'col-span-2',
    disableAnimation = false,
    statsRange = 'run'
  } = appConfig || {}

  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/stats')

  const [down, setDown] = useState(0)
  const [up, setUp] = useState(0)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'stats'
  })

  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  useEffect(() => {
    let mounted = true
    const load = async (): Promise<void> => {
      try {
        const res = await getTrafficStatsSummary(statsRange)
        if (!mounted) return
        setDown(res.down)
        setUp(res.up)
      } catch {
        // ignore
      }
    }
    void load()
    const timer = setInterval(load, STATS_REFRESH_INTERVAL)
    return (): void => {
      mounted = false
      clearInterval(timer)
    }
  }, [statsRange])

  if (iconOnly) {
    return (
      <div className={`${statsCardStatus} flex justify-center`}>
        <Tooltip content="流量统计" placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/stats')
            }}
          >
            <IoStatsChart className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${statsCardStatus} stats-card`}
    >
      {statsCardStatus === 'col-span-2' ? (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimation ? '' : 'scale-[0.95]'} tap-highlight-transparent` : ''} relative overflow-hidden`}
        >
          <CardBody className="pb-1 pt-0 px-0 overflow-y-visible">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <IoStatsChart
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
                />
              </Button>
              <div
                className={`p-2 w-full ${match ? 'text-primary-foreground' : 'text-foreground'} `}
              >
                <div className="flex justify-between">
                  <div className="w-full text-right mr-2">{calcTraffic(up)}</div>
                  <FaCircleArrowUp className="h-6 leading-6" />
                </div>
                <div className="flex justify-between">
                  <div className="w-full text-right mr-2">{calcTraffic(down)}</div>
                  <FaCircleArrowDown className="h-6 leading-6" />
                </div>
              </div>
            </div>
          </CardBody>
          <CardFooter className="pt-1 relative z-10">
            <div
              className={`flex justify-between items-center w-full text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              <h3>流量统计</h3>
              <span className="text-xs font-normal opacity-80">
                {STATS_RANGE_LABELS[statsRange]}
              </span>
            </div>
          </CardFooter>
        </Card>
      ) : (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimation ? '' : 'scale-[0.95]'} tap-highlight-transparent` : ''}`}
        >
          <CardBody className="pb-1 pt-0 px-0 overflow-y-visible">
            <div className="flex justify-between">
              <Button
                isIconOnly
                className="bg-transparent pointer-events-none"
                variant="flat"
                color="default"
              >
                <IoStatsChart
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              流量统计
            </h3>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

export default React.memo(StatsCard, (prevProps, nextProps) => {
  return prevProps.iconOnly === nextProps.iconOnly
})
