import { useEffect, useState } from "react"
import { Users, UserPlus, Shield, Mail, CheckCircle2, AlertCircle, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { apiRequest, ApiError } from "@/lib/api/client"
import { useAuth } from "@/features/auth/auth-context"
import { ROLES, ROLE_LABELS, normalizeRole, type Role } from "@/features/auth/roles"

interface ManagedUser {
  id: string
  email: string
  name?: string
  role: string
  status?: string
  is_active?: boolean
  created_at?: string
}

export default function UsersPage() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Form states for adding a user
  const [newEmail, setNewEmail] = useState("")
  const [newName, setNewName] = useState("")
  const [newRole, setNewRole] = useState<Role>("shopkeeper")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchUsers = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await apiRequest<ManagedUser[]>("/employees")
      setUsers(data)
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError("Could not load users list.")
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchUsers()
  }, [])

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newEmail.trim()) return

    setIsSubmitting(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const created = await apiRequest<ManagedUser>("/employees", {
        method: "POST",
        body: {
          email: newEmail.trim(),
          name: newName.trim() || newEmail.split("@")[0],
          role: newRole,
        },
      })
      setUsers((prev) => [created, ...prev])
      setSuccessMessage(`Account added for ${newEmail} as ${ROLE_LABELS[newRole]}.`)
      setNewEmail("")
      setNewName("")
    } catch (err: any) {
      console.error("Add user error:", err)
      setError(err instanceof ApiError ? err.message : "Failed to add user to database.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRoleChange = async (userId: string, newAssignedRole: Role) => {
    setError(null)
    setSuccessMessage(null)

    try {
      const updated = await apiRequest<ManagedUser>(`/employees/${userId}`, {
        method: "PATCH",
        body: { role: newAssignedRole },
      })
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: updated.role || newAssignedRole } : u))
      )
      setSuccessMessage(`Role updated to ${ROLE_LABELS[newAssignedRole]}.`)
    } catch (err: any) {
      console.error("Role update failed:", err)
      setError(
        err instanceof ApiError
          ? `Failed to update role: ${err.message}`
          : "Server rejected role update. Check backend connection."
      )
      void fetchUsers()
    }
  }

  const handleDeleteUser = async (userToDelete: ManagedUser) => {
    if (userToDelete.id === currentUser?.id || userToDelete.email === currentUser?.email) {
      setError("You cannot delete your own active administrator account.")
      return
    }

    const confirmDelete = window.confirm(
      `Are you sure you want to remove ${userToDelete.email}? They will no longer be able to log in.`
    )
    if (!confirmDelete) return

    setDeletingId(userToDelete.id)
    setError(null)
    setSuccessMessage(null)

    try {
      await apiRequest(`/employees/${userToDelete.id}`, {
        method: "DELETE",
      })
      setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id))
      setSuccessMessage(`Account ${userToDelete.email} removed.`)
    } catch (err: any) {
      console.error("Delete user failed:", err)
      setError(
        err instanceof ApiError
          ? `Failed to delete user: ${err.message}`
          : "Backend error when deleting account."
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-8 p-4 sm:p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Users className="size-6 text-primary" />
          User & Role Management
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage authorized staff accounts and roles. Unlisted accounts will be redirected to the ordinary user notice.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="size-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="size-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Add User Card */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground mb-4">
          <UserPlus className="size-5 text-primary" />
          Add Authorized Account
        </h2>
        <form onSubmit={handleAddUser} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-email">Email Address</Label>
            <div className="relative">
              <Mail className="size-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                id="add-email"
                type="email"
                required
                placeholder="staff@bakery.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-name">Display Name (Optional)</Label>
            <Input
              id="add-name"
              placeholder="e.g. Sarah Connor"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-role">Assigned Role</Label>
            <NativeSelect
              id="add-role"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="sm:col-span-3 flex justify-end pt-2">
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? "Adding..." : "Authorize Account"}
            </Button>
          </div>
        </form>
      </div>

      {/* Users List Table */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="p-4 sm:p-6 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground">
            <Shield className="size-5 text-primary" />
            Authorized Staff List
          </h2>
          <span className="text-xs text-muted-foreground">
            {users.length} {users.length === 1 ? "account" : "accounts"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((item) => {
                const isSelf = item.id === currentUser?.id || item.email === currentUser?.email
                const normalizedCurrentRole = normalizeRole(item.role)

                return (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        {item.name || "Staff Member"}
                        {isSelf && (
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-normal">
                            You
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{item.email}</td>
                    <td className="px-6 py-4">
                      {isSelf ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary">
                          {ROLE_LABELS[normalizedCurrentRole]}
                        </span>
                      ) : (
                        <NativeSelect
                          aria-label={`Change role for ${item.email}`}
                          value={normalizedCurrentRole}
                          onChange={(e) => handleRoleChange(item.id, e.target.value as Role)}
                          className="text-xs h-8 py-1 max-w-[160px]"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!isSelf && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteUser(item)}
                          disabled={deletingId === item.id}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete user"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    No authorized accounts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}