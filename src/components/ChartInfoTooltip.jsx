export default function ChartInfoTooltip({ title, value, color, changeLabel, changeTone, detail }) {
  return (
    <div className="chart-info-tooltip">
      <div className="chart-info-tooltip-title">{title}</div>
      <div className="chart-info-tooltip-value">
        <span className="chart-info-tooltip-bar" style={{ background: color }} />
        <strong>{value}</strong>
        {changeLabel && <span className={`chart-info-tooltip-change${changeTone ? ` is-${changeTone}` : ''}`}>{changeLabel}</span>}
      </div>
      {detail && <div className="chart-info-tooltip-detail">{detail}</div>}
    </div>
  )
}
