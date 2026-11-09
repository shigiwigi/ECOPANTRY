import { SensorPage, type MetricSpec } from "@/features/sensors/SensorPage"

const dhtMissing = (reading: { dht_ok: boolean }) => (reading.dht_ok ? "No reading" : "Sensor not responding")

const METRICS: MetricSpec[] = [
  {
    metric: "temperature_c",
    label: "Temperature",
    unit: "°C",
    decimals: 1,
    color: "chart-1",
    chartTitle: "Temperature history",
    missingText: dhtMissing,
  },
  {
    metric: "humidity_pct",
    label: "Relative humidity",
    unit: "%",
    decimals: 0,
    color: "chart-4",
    chartTitle: "Humidity history",
    missingText: dhtMissing,
  },
]

export default function EnvironmentPage() {
  return (
    <SensorPage
      moduleId="environment"
      metrics={METRICS}
      footnote="DHT11 sensor: about ±2 °C and ±5 % relative humidity."
    />
  )
}
