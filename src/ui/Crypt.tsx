import { useEffect, useRef, useState } from "react";
import { saveBlob } from "../lib/download.ts";
import { plural, stripPdf } from "../lib/format.ts";
import type { PageRef, PdfApi } from "../lib/pdf/types.ts";
import { closePdf, openPdf } from "../lib/render.ts";
import type { FileEntry } from "../state/organize.ts";
import { ChangeReview } from "./ChangeReview.tsx";
import { EmptyDrop } from "./DropFiles.tsx";
import { pdfsOnly, useDropFiles } from "./dropEvents.ts";
import { ALGORITHMS, type CryptAlgorithm } from "../lib/pdf/crypt.ts";
import {
  AddButton,
  Button,
  Card,
  IconButton,
  Notice,
  PageBar,
  SelectField,
  TextField,
} from "./kit.tsx";
import { PageGrid } from "./PageGrid.tsx";
import { PagePreview } from "./PagePreview.tsx";
import { prepareFile } from "./Password.tsx";
import { toast } from "./Toasts.tsx";

type Doc = {
  key: string;
  entry: FileEntry;
  pages: PageRef[];
  wasEncrypted: boolean;
};
type Job = "encrypt" | "decrypt";

let seq = 1;

/** 0 to 4: length, mixed case, digits, symbols. Short passwords stay weak whatever they contain. */
function strength(pw: string): number {
  if (!pw) return 0;
  let n = 0;
  if (pw.length >= 12) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  return pw.length < 8 ? 1 : Math.max(1, n);
}
const STRENGTH_LABEL = ["", "Weak", "Fair", "Good", "Strong"];

function PasswordInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string | null;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <TextField
        ref={inputRef}
        label={label}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        error={error}
        inputClassName="pr-11"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <span className="absolute right-1 top-[26px]">
        <IconButton
          icon={show ? "eyeOff" : "eye"}
          label={
            show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`
          }
          size="sm"
          onClick={() => setShow((s) => !s)}
        />
      </span>
    </div>
  );
}

/** Encrypt a PDF with a password, or remove the password from one you can open. Passwords stay in memory. */
export function Crypt({ api }: { api: PdfApi }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [errs, setErrs] = useState<{ pw?: string; pw2?: string }>({});
  const [changing, setChanging] = useState(false);
  const [algo, setAlgo] = useState<CryptAlgorithm>("aes-256");
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pwRef = useRef<HTMLInputElement | null>(null);
  const pw2Ref = useRef<HTMLInputElement | null>(null);
  const keyRef = useRef<string | null>(null);
  const prev = useRef<Doc | null>(null);

  const drop = () => {
    if (keyRef.current) closePdf(keyRef.current);
    keyRef.current = null;
  };

  useEffect(() => {
    const clear = () => {
      drop();
      setDoc(null);
      setPw("");
      setPw2("");
      setErrs({});
      setJob(null);
      setChanging(false);
    };
    window.addEventListener("yh:clear", clear);
    window.addEventListener("pagehide", drop);
    return () => {
      window.removeEventListener("yh:clear", clear);
      window.removeEventListener("pagehide", drop);
    };
  }, []);

  const open = async (files: File[] | FileList) => {
    const orig = pdfsOnly(files)[0];
    if (!orig) return;
    const ready = await prepareFile(api, orig);
    if (!ready) return;
    const before = doc;
    const key = `crypt${seq++}`;
    try {
      await openPdf(ready.file, key);
    } catch {
      closePdf(key);
      toast(`${orig.name} couldn't be displayed.`, "error");
      return;
    }
    // One file at a time: a new one replaces the old, and the old one can be brought back.
    if (before) {
      prev.current = before;
      toast(`${before.entry.name} replaced`, "info", {
        label: "Undo",
        onClick: () => {
          const old = prev.current;
          if (!old) return;
          void openPdf(old.entry.file, old.key).then(() => {
            drop();
            keyRef.current = old.key;
            setDoc(old);
          });
        },
      });
    } else drop();
    keyRef.current = key;
    setPw("");
    setPw2("");
    setErrs({});
    setChanging(false);
    setDoc({
      key,
      wasEncrypted: ready.wasEncrypted,
      entry: {
        id: key,
        name: orig.name,
        size: ready.file.size,
        origSize: orig.size,
        file: ready.file,
        pageCount: ready.pageCount,
      },
      pages: Array.from({ length: ready.pageCount }, (_, i) => ({
        id: `${key}:${i}`,
        fileId: key,
        srcIndex: i,
        rotation: 0,
      })),
    });
  };
  useDropFiles("crypt", (f) => void open(f));

  const base = doc ? stripPdf(doc.entry.name) : "";
  const wantsPassword = !!doc && (!doc.wasEncrypted || changing);

  const validate = (): boolean => {
    const next: { pw?: string; pw2?: string } = {};
    if (!pw) next.pw = "Enter a password.";
    else if (pw.includes(",")) next.pw = "Passwords can't contain commas.";
    if (!next.pw && pw2 !== pw) next.pw2 = "The two passwords don't match.";
    setErrs(next);
    if (next.pw) pwRef.current?.focus();
    else if (next.pw2) pw2Ref.current?.focus();
    return !next.pw && !next.pw2;
  };

  const run = async () => {
    const which = job;
    setJob(null);
    if (!doc || !which) return;
    setBusy(true);
    try {
      // The worker reads the file and returns a Blob, so a large PDF is never copied into the page.
      if (which === "encrypt") {
        const out = await api.encryptFile(doc.entry.file, pw, algo);
        saveBlob(out, `${base}-encrypted.pdf`);
        toast(
          `${base}-encrypted.pdf downloaded. Keep the password: it can't be recovered.`,
          "success",
        );
      } else {
        saveBlob(doc.entry.file, `${base}-unlocked.pdf`); // already the unlocked copy
        toast(
          `${base}-unlocked.pdf downloaded. It opens without a password.`,
          "success",
        );
      }
      setPw("");
      setPw2("");
    } catch (err) {
      toast(
        `That didn't work: ${err instanceof Error ? err.message : "unknown problem"}. Try again.`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const score = strength(pw);

  return (
    <div className="space-y-7">
      <PageBar
        title="Encrypt & Decrypt"
        description="Protect a PDF with a password, or unlock one you have the password for."
        status={doc ? `${doc.entry.name} · ${wantsPassword ? plural(doc.pages.length, "page") : "unlocked"}` : undefined}
        add={doc && <AddButton label="Change PDF" onClick={() => inputRef.current?.click()} />}
      >
        {doc &&
          (wantsPassword ? (
            <Button
              variant="primary"
              size="sm"
              icon="lock"
              loading={busy}
              loadingLabel="Encrypting…"
              onClick={() => {
                if (validate()) setJob("encrypt");
              }}
            >
              Encrypt and download
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon="unlock" loading={busy} loadingLabel="Removing…" onClick={() => setJob("decrypt")}>
              Remove password and download
            </Button>
          ))}
      </PageBar>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="crypt-file-input"
        data-yh-add="true"
        onChange={(e) => {
          if (e.target.files?.length) void open(e.target.files);
          e.target.value = "";
        }}
      />

      {!doc ? (
        <EmptyDrop
          icon="lock"
          title="Open a PDF to protect or unlock"
          hint="Passwords are used in memory only and never saved."
          chooseLabel="Choose a PDF"
          onFiles={(f) => void open(f)}
          onChoose={() => inputRef.current?.click()}
        />
      ) : (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
            <Card
              title="Preview"
              aside={
                <div className="flex items-center gap-1">
                  <span
                    className="max-w-[260px] truncate text-sm text-text-muted tabular-nums"
                    title={doc.entry.name}
                  >
                    {doc.entry.name} · {plural(doc.pages.length, "page")}
                  </span>
                  <IconButton
                    icon="trash"
                    label={`Remove ${doc.entry.name}`}
                    tip="Remove this PDF"
                    danger
                    onClick={() => {
                      drop();
                      setDoc(null);
                    }}
                  />
                </div>
              }
            >
              <PageGrid
                pages={doc.pages}
                fileName={doc.entry.name}
                fileNo={1}
                selected={new Set()}
                readOnly
                onSetMany={() => {}}
                onToggle={() => {}}
                onZoom={setPreview}
              />
            </Card>

            <aside
              aria-label="Protection"
              className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+24px)]"
            >
              <Card
                title={wantsPassword ? "Add a password" : "Remove password"}
              >
                <div data-testid="crypt-status">
                  {doc.wasEncrypted ? (
                    <Notice kind="success">
                      Protected PDF, unlocked for viewing. The password
                      isn&rsquo;t stored.
                    </Notice>
                  ) : (
                    <Notice kind="info">This PDF isn&rsquo;t protected.</Notice>
                  )}
                </div>

                {wantsPassword ? (
                  <form
                    className="space-y-4"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (validate()) setJob("encrypt");
                    }}
                  >
                    <PasswordInput
                      label="Password"
                      value={pw}
                      onChange={(v) => {
                        setPw(v);
                        setErrs((x) => ({ ...x, pw: undefined }));
                      }}
                      error={errs.pw}
                      inputRef={pwRef}
                      onBlur={() =>
                        pw.includes(",") &&
                        setErrs((x) => ({
                          ...x,
                          pw: "Passwords can't contain commas.",
                        }))
                      }
                    />
                    <div aria-hidden={!pw} className="space-y-1.5">
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className={`h-1 flex-1 rounded-pill ${i <= score ? (score <= 1 ? "bg-danger" : score === 2 ? "bg-warning" : "bg-success") : "bg-surface-sunken"}`}
                          />
                        ))}
                      </div>
                      <p
                        className="text-xs text-text-muted"
                        data-testid="strength"
                      >
                        {pw ? `Strength: ${STRENGTH_LABEL[score]}` : " "}
                      </p>
                    </div>
                    <PasswordInput
                      label="Confirm password"
                      value={pw2}
                      onChange={(v) => {
                        setPw2(v);
                        setErrs((x) => ({ ...x, pw2: undefined }));
                      }}
                      error={errs.pw2}
                      inputRef={pw2Ref}
                      onBlur={() =>
                        pw2 &&
                        pw2 !== pw &&
                        setErrs((x) => ({
                          ...x,
                          pw2: "The two passwords don't match.",
                        }))
                      }
                    />
                    <SelectField
                      label="Encryption"
                      value={algo}
                      onChange={(e) =>
                        setAlgo(e.target.value as CryptAlgorithm)
                      }
                      help={ALGORITHMS.find((a) => a.id === algo)?.note}
                    >
                      {ALGORITHMS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </SelectField>
                    {ALGORITHMS.find((a) => a.id === algo)?.weak && (
                      <Notice kind="warning">
                        This method can be broken quickly. Use it only if the
                        PDF must open in a very old reader.
                      </Notice>
                    )}
                    <Notice kind="warning">
                      If you lose this password, the file can&rsquo;t be opened.
                    </Notice>
                    <Button
                      type="submit"
                      variant="primary"
                      size="xl"
                      icon="lock"
                      className="w-full max-sm:hidden"
                      loading={busy}
                      loadingLabel="Encrypting…"
                    >
                      Encrypt and download
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <Button
                      variant="primary"
                      size="xl"
                      icon="unlock"
                      className="w-full max-sm:hidden"
                      loading={busy}
                      loadingLabel="Removing…"
                      onClick={() => setJob("decrypt")}
                    >
                      Remove password and download
                    </Button>
                    <Button variant="text" onClick={() => setChanging(true)}>
                      Change password instead
                    </Button>
                  </div>
                )}
              </Card>
            </aside>
          </div>
        </>
      )}

      <ChangeReview
        open={job !== null}
        title={
          job === "encrypt"
            ? "Review before encrypting"
            : "Review before decrypting"
        }
        summary={
          job === "encrypt"
            ? `Pages stay the same. A new copy of ${doc?.entry.name ?? ""} will need the password you typed to open. Your original is not changed.`
            : `Pages stay the same. A new copy of ${doc?.entry.name ?? ""} will open without a password. Your original is not changed.`
        }
        sections={[]}
        confirmLabel={
          job === "encrypt" ? "Confirm and encrypt" : "Confirm and decrypt"
        }
        onCancel={() => setJob(null)}
        onConfirm={() => void run()}
      />
      <PagePreview
        pages={doc?.pages ?? []}
        index={preview}
        onIndex={setPreview}
        caption={(p) => `Page ${p.srcIndex + 1}`}
      />
    </div>
  );
}
