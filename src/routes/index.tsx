import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, Layers, MessageSquare, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "PagePilot — Agende e publique no Facebook em escala" },
      { name: "description", content: "Conecte centenas de Páginas do Facebook, agende, publique em massa e automatize comentários — tudo em um painel moderno." },
      { property: "og:title", content: "PagePilot — Publicação em massa para Páginas do Facebook" },
      { property: "og:description", content: "SaaS profissional para gerenciar, agendar e publicar conteúdo no Facebook via Graph API." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 backdrop-blur sticky top-0 z-30 bg-background/70">
        <div className="container mx-auto max-w-6xl flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-md bg-primary grid place-items-center text-primary-foreground font-bold">P</div>
            <span className="font-semibold tracking-tight">PagePilot</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost">Entrar</Button></Link>
            <Link to="/auth"><Button>Começar grátis<ArrowRight className="ml-2 size-4" /></Button></Link>
          </div>
        </div>
      </header>

      <section className="container mx-auto max-w-6xl px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3" /> Construído para gestores de centenas de páginas
        </div>
        <h1 className="mt-6 text-5xl md:text-6xl font-semibold tracking-tight">
          Publique em massa no <span className="text-primary">Facebook</span>,<br /> sem perder tempo.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Conecte suas páginas via Graph API, agende publicações, automatize comentários e gerencie tudo em um painel rápido e moderno.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/auth"><Button size="lg">Criar conta<ArrowRight className="ml-2 size-4" /></Button></Link>
          <Link to="/auth"><Button size="lg" variant="outline">Já tenho conta</Button></Link>
        </div>
      </section>

      <section className="container mx-auto max-w-6xl px-6 pb-24 grid md:grid-cols-3 gap-4">
        {[
          { i: Layers, t: "Páginas ilimitadas", d: "Cole o Access Token e conecte quantas páginas precisar." },
          { i: CalendarClock, t: "Agendamento inteligente", d: "Calendário com fila por horário, página e grupo." },
          { i: MessageSquare, t: "Auto-comentário", d: "Posta um comentário no seu próprio post após X segundos." },
          { i: Zap, t: "Publicação em massa", d: "Selecione dezenas de páginas e dispare em paralelo." },
          { i: ShieldCheck, t: "Tokens criptografados", d: "Seus tokens ficam protegidos no backend, nunca no navegador." },
          { i: Sparkles, t: "Interface moderna", d: "Dark mode, busca global, atalhos e métricas em tempo real." },
        ].map(({ i: Icon, t, d }) => (
          <div key={t} className="rounded-xl border border-border/60 bg-card p-6">
            <Icon className="size-5 text-primary" />
            <h3 className="mt-4 font-semibold">{t}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} PagePilot. Não afiliado ao Facebook / Meta.
      </footer>
    </div>
  );
}
