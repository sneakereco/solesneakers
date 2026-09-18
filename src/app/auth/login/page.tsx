import { pageMetadata } from "@/lib/metadata";

// app/auth/login/page.tsx
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/login/LoginFormRouter";

export const metadata = pageMetadata(
  "Sign In",
  "Sign in to your Solesneakers account to view orders and manage your profile.",
);

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/account");
  }

  return <LoginForm />;
}
