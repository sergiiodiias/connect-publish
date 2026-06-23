import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, CalendarClock, FileEdit, FileSpreadsheet, KeyRound, Layers, LayoutDashboard, LogOut, MessageCircle, MessageSquare, Settings as SettingsIcon, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/composer", label: "Agendar postagens", icon: FileEdit },
  { to: "/sheets", label: "Importar Planilha", icon: FileSpreadsheet },
  { to: "/queue", label: "Agenda", icon: CalendarClock },
  { to: "/comments", label: "Comentários", icon: MessageCircle },
  { to: "/engagement", label: "Engajamento", icon: TrendingUp },
  { to: "/pages", label: "Páginas", icon: Layers },
  { to: "/extract", label: "Extrair tokens", icon: KeyRound },
  { to: "/groups", label: "Grupos", icon: Users },
  { to: "/logs", label: "Histórico", icon: BarChart3 },
  { to: "/settings", label: "Ajustes", icon: SettingsIcon },
] as const;

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState(user?.email ?? "");

  useEffect(() => setEmail(user?.email ?? ""), [user]);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen grid grid-cols-[240px_1fr] bg-background text-foreground">
      <aside className="border-r border-border/60 bg-sidebar text-sidebar-foreground flex flex-col">
        <Link to="/dashboard" className="h-16 px-5 flex items-center gap-2 border-b border-border/60">
          <div className="size-8 rounded-md bg-primary grid place-items-center text-primary-foreground font-bold">P</div>
          <span className="font-semibold tracking-tight">PagePilot</span>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-3 border-t border-border/60">
          <div className="px-3 py-2 text-xs text-muted-foreground truncate">{email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={signOut}>
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </aside>
      <main className="min-h-screen overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
