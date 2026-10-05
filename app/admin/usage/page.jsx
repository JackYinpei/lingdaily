'use client'

import { useCallback, useEffect, useState } from 'react'

const RANGES = [7, 30, 90]
const FEATURE_LABELS = {
  practice: '文字对话', scenario: '生成场景', ideas: '换一批', translate: '单句翻译', suggest: '卡住时的建议', live: '语音通话',
}

const number = value => new Intl.NumberFormat('zh-CN').format(value || 0)
const cost = group => group.cost > 0 || !group.unpriced
  ? `$${group.cost.toFixed(4)}${group.unpriced ? ' +未定价' : ''}`
  : '未定价'

function Breakdown({ title, rows, label }) {
  if (!rows?.length) return null
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              {['', '调用', '输入', '其中音频', '输出', '其中音频', '思考', '合计 token', '估算花费'].map((heading, index) => (
                <th key={index} className={`px-3 py-2 font-medium ${index ? 'text-right' : 'text-left'}`}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.key} className="border-t border-border">
                <td className="px-3 py-2 whitespace-nowrap">{label(row)}</td>
                <td className="px-3 py-2 text-right">{number(row.calls)}</td>
                <td className="px-3 py-2 text-right">{number(row.input_tokens)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{number(row.input_audio_tokens)}</td>
                <td className="px-3 py-2 text-right">{number(row.output_tokens)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{number(row.output_audio_tokens)}</td>
                <td className="px-3 py-2 text-right">{number(row.thinking_tokens)}</td>
                <td className="px-3 py-2 text-right font-medium">{number(row.total_tokens)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{cost(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function UsageAdminPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/admin/usage?days=${days}`, { cache: 'no-store' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`)
      setData(json)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const total = data?.total
  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">AI 用量（iOS）</h1>
          <p className="text-sm text-muted-foreground mt-1">
            文字类按每次模型调用记录；语音通话由 App 在挂断时上报。花费仅对在 AI_PRICING_JSON 中配置了价格的模型估算。
          </p>
        </div>
        <div className="flex gap-2">
          {RANGES.map(range => (
            <button
              key={range}
              onClick={() => setDays(range)}
              className={`px-3 py-1.5 rounded text-sm border border-border ${days === range ? 'bg-primary text-primary-foreground' : ''}`}
            >
              {range} 天
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive mb-6">读取失败：{error}</p> : null}
      {loading && !data ? <p className="text-sm text-muted-foreground">加载中…</p> : null}

      {total ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            ['合计 token', number(total.total_tokens)],
            ['调用次数', number(total.calls)],
            ['使用人数', number(data.users)],
            ['估算花费', cost(total)],
          ].map(([label, value]) => (
            <div key={label} className="border border-border rounded-lg p-4 bg-card">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold mt-1">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <Breakdown title="按功能" rows={data?.byFeature} label={row => FEATURE_LABELS[row.key] || row.key} />
      <Breakdown title="按模型" rows={data?.byModel} label={row => row.key} />
      <Breakdown title="按用户（前 50）" rows={data?.byUser} label={row => row.email || row.key} />
      <Breakdown title="按天（北京时间）" rows={data?.byDay} label={row => row.key} />
    </main>
  )
}
