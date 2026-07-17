// src/components/auth/2fa/QRDisplay.tsx
export function QRDisplay({
  qrCode,
  onQrError,
}: {
  qrCode: string;
  onQrError?: () => void;
}) {
  return (
    <div className="border border-zinc-300 bg-white p-6">
      <div className="flex justify-center">
        <img
          src={qrCode}
          alt="2FA QR Code"
          className="h-48 w-48 bg-white p-3"
          loading="lazy"
          onError={() => onQrError?.()}
        />
      </div>

      <p className="mt-4 text-center text-[0.72rem] uppercase tracking-[0.18em] text-zinc-500">
        Scan with Google Authenticator or any TOTP app
      </p>
    </div>
  );
}
