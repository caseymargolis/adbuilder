"use client";

export default function SignOutButton() {
  return (
    <button
      type="button"
      className="text-xs text-[color:var(--muted)] hover:underline"
      onClick={async () => {
        await fetch("/api/login", { method: "DELETE" });
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
