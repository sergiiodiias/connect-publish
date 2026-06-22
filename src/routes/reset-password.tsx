import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Redefinir senha — PagePilot" }] }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Senha redefinida");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-4">
        <h1 className="text-xl font-semibold">Definir nova senha</h1>
        <div className="space-y-2"><Label>Nova senha</Label><Input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></div>
        <Button className="w-full" disabled={loading}>Salvar</Button>
      </form>
    </div>
  );
}
