import { useQuery } from "@tanstack/react-query"
import { CloudOff, PackagePlus, Package, Plus } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { hasRole } from "@/features/auth/roles"
import { ingredientsQuery, PAGE_SIZE, type Ingredient } from "@/features/inventory/api"
import { IngredientSheet } from "@/features/inventory/IngredientSheet"
import { ReceiveSheet } from "@/features/inventory/ReceiveSheet"
import { STOCK_MANAGER_ROLES } from "@/features/inventory/roles"
import { failureMessage, formatQty, useDebounced } from "@/features/inventory/format"
import { Notice, Pager } from "@/features/inventory/ui"
import { cn } from "@/lib/utils"

export default function InventoryPage() {
  const module = getModule("inventory")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={Package}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share stock."
        />
      ) : (
        <StockOverview />
      )}
    </div>
  )
}

function StockOverview() {
  const { user } = useAuth()
  const canManage = hasRole(user, STOCK_MANAGER_ROLES)
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const q = useDebounced(search.trim())
  const query = useQuery(ingredientsQuery({ q: q || undefined, offset, active: true }))
  const [receiving, setReceiving] = useState<{ ingredientId?: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState("")

  return (
    <>
      {message && <Notice tone="success">{message}</Notice>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="ingredient-search" className="sr-only">
            Search ingredients
          </label>
          <Input
            id="ingredient-search"
            type="search"
            placeholder="Search ingredients"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
            autoComplete="off"
          />
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add ingredient
            </Button>
            <Button onClick={() => setReceiving({})}>
              <PackagePlus aria-hidden />
              Receive stock
            </Button>
          </div>
        )}
      </div>

      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading stock…</p>
      ) : query.isError ? (
        <EmptyState icon={CloudOff} title="Stock couldn't be loaded" description={failureMessage(query.error, "Try again.")}>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </EmptyState>
      ) : query.data.items.length === 0 ? (
        <EmptyState
          icon={Package}
          title={q ? "No ingredient matches your search" : "No ingredients yet"}
          description={
            q
              ? "Try a different spelling."
              : canManage
                ? "Add the ingredients the bakery keeps, then receive stock of each."
                : "An administrator or storekeeper adds ingredients and receives stock."
          }
        />
      ) : (
        <>
          <IngredientTable items={query.data.items} canManage={canManage} onReceive={(id) => setReceiving({ ingredientId: id })} />
          <Pager total={query.data.total} offset={offset} limit={PAGE_SIZE} onOffset={setOffset} />
        </>
      )}

      <ReceiveSheet
        open={receiving !== null}
        onOpenChange={(open) => !open && setReceiving(null)}
        ingredientId={receiving?.ingredientId}
        onReceived={(batch) =>
          setMessage(`Received ${formatQty(batch.quantity)} ${batch.ingredient.unit} of ${batch.ingredient.name}. Batch ${batch.label_code.slice(0, 5)}-${batch.label_code.slice(5)} is ready to label.`)
        }
      />
      <IngredientSheet open={adding} onOpenChange={setAdding} onAdded={(ingredient) => setMessage(`Added ${ingredient.name}.`)} />
    </>
  )
}

function IngredientTable({
  items,
  canManage,
  onReceive,
}: {
  items: Ingredient[]
  canManage: boolean
  onReceive: (ingredientId: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">Ingredient stock</caption>
        <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Ingredient
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">
              In stock
            </th>
            <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
              Reorder level
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
            {canManage && (
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((item) => (
            <tr key={item.id}>
              <th scope="row" className="px-4 py-3 text-left font-medium">
                <Link to={`/portal/batches?ingredient=${item.id}`} className="underline-offset-4 hover:underline">
                  {item.name}
                </Link>
              </th>
              <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                {formatQty(item.total_remaining)} {item.unit.code}
              </td>
              <td className="hidden px-4 py-3 text-right whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                {item.reorder_level ? `${formatQty(item.reorder_level)} ${item.unit.code}` : "Not set"}
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
                    item.low_stock ? "border-warning/40 bg-warning/10 text-warning" : "border-success/40 bg-success/10 text-success",
                  )}
                >
                  {item.low_stock ? "Low stock" : "OK"}
                </span>
              </td>
              {canManage && (
                <td className="px-4 py-3 text-right">
                  <Button variant="outline" size="sm" onClick={() => onReceive(item.id)} aria-label={`Receive ${item.name}`}>
                    Receive
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
