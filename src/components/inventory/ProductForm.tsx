// src/components/inventory/ProductForm.tsx
"use client";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { ActionButton } from "@/components/ui/ActionButton";
import { adminCommand } from "@/components/admin/admin-command";
import { fetchJsonWithDeadline } from "@/lib/http/request-deadline";
import { useId } from "react";
import { useHydrated } from "@/components/ui/useHydrated";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { GripVertical, ImagePlus, Plus, Trash2, X } from "lucide-react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

import type { Category, Condition, SizeType } from "@/types/domain/product";
import type { ProductCreateInput } from "@/services/product-service";
import { logError } from "@/lib/utils/log";
import { Toast } from "@/components/ui/Toast";
import { RdkSelect } from "@/components/ui/Select";
import { SpecialtyProductForm } from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/SpecialtyProductForm";
import type {
  SpecialtyProductDraft,
  SpecialtyProductWrite,
} from "@/Modules/SpecialtyProducts/Source/Features/ManageProducts/specialty-product-contract";

// OPTIMIZATION: Lazy load image compression library
const loadImageCompression = () => import("browser-image-compression");

interface ProductFormProps {
  specialtyInitial?: SpecialtyProductDraft;
  onSpecialtySubmit?: (data: SpecialtyProductWrite) => Promise<void>;
  initialData?: Omit<Partial<ProductCreateInput>, "variants"> & {
    id?: string;
    variants?: Array<
      ProductCreateInput["variants"][number] & { size?: { id: string; label: string } }
    >;
  };
  onSubmit: (data: ProductCreateInput) => Promise<void>;
  onCancel: () => void;
  onCheckSave?: () => Promise<void>;

  initialBrands?: Array<{
    id: string;
    label: string;
  }>;
  initialModels?: Array<{ id: string; label: string }>;
  initialSizes?: Array<{ id: string; label: string; sizeType: string }>;
}

type VariantDraft = {
  draft_id: string;
  id?: string;
  sku: string;
  size_id: string;
  size_label: string;
  salePrice: string;
  unitCost: string;
  stock: string;
};

type ImageDraft = ProductCreateInput["images"][number];

type CatalogOption = {
  id: string;
  label: string;
};

type BrandCatalogEntry = {
  id: string;
  canonical_label: string;
};

type ModelCatalogEntry = {
  id: string;
  canonical_label: string;
};

type TitleParseResult = {
  titleRaw: string;
  titleDisplay: string;
  brand: {
    id: string | null;
    label: string;
  };
  model: {
    id: string | null;
    label: string | null;
  };
  name: string;
  suggestions?: {
    brand?: { id: string; label: string; confidence: number };
    model?: { id: string; label: string; confidence: number };
  };
};

type UploadResult = {
  url: string;
  path?: string;
  mimeType?: string;
  bytes?: number;
  hash?: string;
  bucket?: string;
};

type UploadFailure = {
  index?: number;
  fileName?: string;
  error?: string;
};

type UploadsResponse = {
  uploads: UploadResult[];
  count?: number;
  failures?: UploadFailure[];
  requestId?: string;
};

type UploadErrorResponse = {
  error?: string;
  message?: string;
  requestId?: string;
  details?: unknown;
};

const isUploadResult = (value: unknown): value is UploadResult => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.url === "string";
};

const isUploadsResponse = (value: unknown): value is UploadsResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.uploads);
};

const normalizeImages = (items: ImageDraft[]) => {
  const hasPrimary = items.some((item) => item.is_primary);
  return items.map((item, index) => ({
    ...item,
    sort_order: index,
    is_primary: hasPrimary ? item.is_primary : index === 0,
  }));
};

const formatMoney = (value: number) => value.toFixed(2);

const toDateTimeLocalValue = (value?: string) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const getSizeTypeForCategory = (category: Category): SizeType => {
  if (category === "sneakers") {
    return "shoe";
  }
  if (category === "clothing") {
    return "clothing";
  }
  if (category === "accessories") {
    return "custom";
  }
  return "none";
};

const createVariantDraftId = () =>
  `variant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const createDraftSku = () =>
  `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;

function RequiredMark() {
  return <span className="text-red-500">*</span>;
}

type SortableVariantRenderProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef" | "isDragging" | "isOver"
>;

interface SortableVariantRowProps {
  id: string;
  className: string;
  children: (props: SortableVariantRenderProps) => React.ReactNode;
}

function SortableVariantRow({ id, className, children }: SortableVariantRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 220ms cubic-bezier(0.2, 0, 0, 1)",
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging, isOver })}
    </div>
  );
}

type OrdinaryFormState = {
  work: ReturnType<typeof useAsyncAction>;
  workKind: "save" | "upload";
  setWorkKind: Dispatch<SetStateAction<"save" | "upload">>;
  saved: boolean;
  setSaved: Dispatch<SetStateAction<boolean>>;
};

export function ProductForm(props: ProductFormProps) {
  // The category selector and ordinary form share one operation owner.
  const work = useAsyncAction();
  const [workKind, setWorkKind] = useState<"save" | "upload">("save");
  const [saved, setSaved] = useState(false);
  const [specialtyBusy, setSpecialtyBusy] = useState(false);
  const categoryLocked = work.pending || saved || specialtyBusy || !!props.onCheckSave;
  const [specialty, setSpecialty] = useState(props.initialData?.category === "specialty");
  const editing = Boolean(props.initialData?.id || props.specialtyInitial);
  return (
    <div className="space-y-4">
      {!editing && props.onSpecialtySubmit && (
        <label className="block text-sm text-zinc-300">
          Product category
          <select
            className="ml-3 rounded border border-zinc-700 bg-zinc-900 p-2"
            value={specialty ? "specialty" : "ordinary"}
            disabled={categoryLocked}
            onChange={(event) => {
              if (!categoryLocked) setSpecialty(event.target.value === "specialty");
            }}
          >
            <option value="ordinary">Standard product</option>
            <option value="specialty">Specialty giveaway</option>
          </select>
        </label>
      )}
      {specialty && props.onSpecialtySubmit ? (
        <SpecialtyProductForm
          onActivityChange={setSpecialtyBusy}
          initial={props.specialtyInitial}
          onSubmit={props.onSpecialtySubmit}
          onCancel={props.onCancel}
        />
      ) : (
        <OrdinaryProductForm
          {...props}
          work={work}
          workKind={workKind}
          setWorkKind={setWorkKind}
          saved={saved}
          setSaved={setSaved}
        />
      )}
    </div>
  );
}

function OrdinaryProductForm({
  initialData,
  onSubmit,
  onCancel,
  onCheckSave,
  work,
  workKind,
  setWorkKind,
  saved,
  setSaved,
  initialBrands, // NEW
  initialModels,
  initialSizes = [],
}: ProductFormProps & OrdinaryFormState) {
  const id = useId();
  const hydrated = useHydrated();
  const [fieldError, setFieldError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const [parseAttempt, retryParse] = useState(0);
  const [catalogAttempt, retryCatalog] = useState(0);
  const [brandStatus, setBrandStatus] = useState<"loading" | "error" | "idle">(
    initialBrands ? "idle" : "loading",
  );
  const [modelRead, setModelRead] = useState<{
    brandId: string;
    status: "loading" | "error" | "idle";
  }>();
  const isLoading = work.pending && workKind === "save";
  const uploading = work.pending && workKind === "upload";

  const initialTitle = initialData?.name ?? "";
  const [titleRaw, setTitleRaw] = useState(initialTitle);

  const [parsedTitle, setParseResult] = useState<TitleParseResult | null>(null);
  const [parseRead, setParseRead] = useState<{
    key: string;
    status: "loading" | "error" | "idle";
  }>();

  const [brandOverrideId, setBrandOverrideId] = useState<string | null>(
    initialData?.brand_id ?? null,
  );
  const [brandOverrideInput, setBrandOverrideInput] = useState(
    initialBrands?.find((brand) => brand.id === initialData?.brand_id)?.label ?? "",
  );
  const [modelOverrideId, setModelOverrideId] = useState<string | null>(
    initialData?.model_id ?? null,
  );
  const [modelOverrideInput, setModelOverrideInput] = useState(
    initialModels?.find((model) => model.id === initialData?.model_id)?.label ?? "",
  );

  const [category, setCategory] = useState<Category>(initialData?.category || "sneakers");
  const parseKey = JSON.stringify([titleRaw, category, brandOverrideId, modelOverrideId]);
  const parseStatus = !titleRaw.trim()
    ? "idle"
    : parseRead?.key === parseKey
      ? parseRead.status
      : "loading";
  const [parsedKey, setParsedKey] = useState("");
  const parseResult = parsedKey === parseKey ? parsedTitle : null;
  // UPDATED: Use server data if provided
  const [brandOptions, setBrandOptions] = useState<CatalogOption[]>(initialBrands || []);
  const [loadedModels, setModelOptions] = useState<CatalogOption[]>(initialModels ?? []);
  const [sizeOptions] = useState(initialSizes);

  const [condition, setCondition] = useState<Condition>(initialData?.condition || "new");
  const [description, setDescription] = useState(initialData?.description || "");
  const [publishMode, setPublishMode] = useState<"immediately" | "scheduled">(() => {
    const goLiveAt = initialData?.go_live_at;
    if (!goLiveAt) {
      return "immediately";
    }
    const parsed = Date.parse(goLiveAt);
    if (!Number.isFinite(parsed)) {
      return "immediately";
    }
    return parsed > Date.now() ? "scheduled" : "immediately";
  });
  const [scheduledGoLiveAt, setScheduledGoLiveAt] = useState(() =>
    toDateTimeLocalValue(initialData?.go_live_at),
  );

  const [uploadQueue, setUploadQueue] = useState<{
    total: number;
    completed: number;
    failed: number;
    isUploading: boolean;
    currentStatus?: string;
  }>({
    total: 0,
    completed: 0,
    failed: 0,
    isUploading: false,
  });

  const [variants, setVariants] = useState<VariantDraft[]>(() => {
    const sizeType = getSizeTypeForCategory(initialData?.category || "sneakers");
    const sortedInitialVariants = [...(initialData?.variants ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    const mapped = sortedInitialVariants.map((variant, index) => ({
      draft_id: variant.id ?? `initial-${index}`,
      id: variant.id ?? undefined,
      sku: variant.sku?.trim() ?? "",
      size_id: variant.size_id,
      size_label: variant.size?.label.trim() ?? "",
      salePrice: formatMoney(variant.sale_price_cents / 100),
      unitCost: formatMoney((variant.unit_cost_cents ?? 0) / 100),
      stock: String(variant.stock ?? 0),
    }));

    const defaultSize = initialSizes.find((size) => size.sizeType === sizeType);

    return mapped.length > 0
      ? mapped
      : [
          {
            draft_id: "initial-0",
            sku: "",
            size_id: defaultSize?.id ?? "",
            size_label: defaultSize?.label ?? "",
            salePrice: "",
            unitCost: "",
            stock: "1",
          },
        ];
  });

  if (hydrated && variants.some((variant) => !variant.sku)) {
    setVariants(
      variants.map((variant) =>
        variant.sku ? variant : { ...variant, sku: createDraftSku() },
      ),
    );
  }

  const [images, setImages] = useState<ImageDraft[]>(() =>
    normalizeImages(initialData?.images ?? []),
  );

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);

  const sizeType = useMemo(() => getSizeTypeForCategory(category), [category]);
  const variantIds = useMemo(
    () => variants.map((variant) => variant.draft_id),
    [variants],
  );
  const scheduleMin = useMemo(
    () => (hydrated ? toDateTimeLocalValue(new Date().toISOString()) : undefined),
    [hydrated],
  );
  const variantDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ensureScheduledTime = useCallback(() => {
    if (scheduledGoLiveAt.trim()) {
      return;
    }
    const defaultTime = toDateTimeLocalValue(new Date().toISOString());
    setScheduledGoLiveAt(defaultTime);
  }, [scheduledGoLiveAt]);

  const isUploadErrorResponse = (value: unknown): value is UploadErrorResponse => {
    if (!value || typeof value !== "object") {
      return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.error === "string" || typeof record.message === "string";
  };

  useEffect(() => {
    if (initialBrands) return;
    const controller = new AbortController();
    const loadBrands = async () => {
      try {
        setBrandStatus("loading");
        const data = await fetchJsonWithDeadline<{ brands: BrandCatalogEntry[] }>(
          "/api/admin/tags/brands",
          "Brands unavailable",
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setBrandStatus("idle");
          const options = (data.brands || []).map((brand: BrandCatalogEntry) => ({
            id: brand.id,
            label: brand.canonical_label,
          }));
          setBrandOptions(options);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setBrandStatus("error");
        logError(error, { layer: "frontend", event: "inventory_load_brand_catalog" });
      }
    };
    void loadBrands();
    return () => controller.abort();
  }, [initialBrands, catalogAttempt]);

  const effectiveBrandId = brandOverrideId ?? parseResult?.brand?.id ?? null;
  const effectiveModelId = modelOverrideId ?? parseResult?.model?.id ?? null;
  const modelStatus = !effectiveBrandId
    ? "idle"
    : modelRead?.brandId === effectiveBrandId
      ? modelRead.status
      : "loading";
  const modelOptions = effectiveBrandId && modelStatus === "idle" ? loadedModels : [];

  useEffect(() => {
    if (!effectiveBrandId) {
      return;
    }
    const controller = new AbortController();
    const loadModels = async () => {
      try {
        setModelRead({ brandId: effectiveBrandId, status: "loading" });
        const data = await fetchJsonWithDeadline<{ models: ModelCatalogEntry[] }>(
          `/api/admin/tags/models?brandId=${effectiveBrandId}`,
          "Models unavailable",
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setModelRead({ brandId: effectiveBrandId, status: "idle" });
          const options = (data.models || []).map((model: ModelCatalogEntry) => ({
            id: model.id,
            label: model.canonical_label,
          }));
          const selectedInitial =
            initialData?.brand_id === effectiveBrandId &&
            initialModels?.find((model) => model.id === effectiveModelId);
          const nextOptions: CatalogOption[] =
            selectedInitial &&
            !options.some((option: CatalogOption) => option.id === selectedInitial.id)
              ? [...options, selectedInitial]
              : options;
          setModelOptions(nextOptions);
          if (modelOverrideId && nextOptions.length > 0) {
            const selected = nextOptions.find((option) => option.id === modelOverrideId);
            if (!selected) setModelOverrideId(null);
            setModelOverrideInput(selected?.label ?? "");
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setModelRead({ brandId: effectiveBrandId, status: "error" });
        logError(error, { layer: "frontend", event: "inventory_load_model_catalog" });
      }
    };

    void loadModels();
    return () => controller.abort();
  }, [
    effectiveBrandId,
    effectiveModelId,
    initialData?.brand_id,
    initialModels,
    modelOverrideId,
    catalogAttempt,
  ]);

  useEffect(() => {
    if (!titleRaw.trim()) {
      return;
    }

    const controller = new AbortController();
    const parseTitle = async () => {
      setParseRead({ key: parseKey, status: "loading" });
      try {
        const { response, data } = await adminCommand<
          TitleParseResult & { error?: string }
        >(
          "/api/admin/tags/parse-title",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              titleRaw,
              category,
              brandOverrideId,
              modelOverrideId,
            }),
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!response.ok || !data) {
          throw new Error(data?.error || "Failed to parse title.");
        }
        setParsedKey(parseKey);
        setParseResult(data);
        setParseRead({ key: parseKey, status: "idle" });
      } catch (error: unknown) {
        const isAbort =
          error instanceof DOMException
            ? error.name === "AbortError"
            : typeof error === "object" &&
              error !== null &&
              "name" in error &&
              (error as { name?: string }).name === "AbortError";
        if (controller.signal.aborted || isAbort) {
          return;
        }
        logError(error, { layer: "frontend", event: "inventory_parse_title" });
        setParseRead({ key: parseKey, status: "error" });
      }
    };
    const timeout = setTimeout(() => {
      void parseTitle();
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [titleRaw, category, brandOverrideId, modelOverrideId, parseKey, parseAttempt]);

  const changeCategory = (nextCategory: Category) => {
    setCategory(nextCategory);
    const nextSizeType = getSizeTypeForCategory(nextCategory);
    if (nextSizeType === sizeType) {
      return;
    }
    setVariants((current) =>
      current.map((variant) => {
        if (nextSizeType === "none") {
          const oneSize = sizeOptions.find((size) => size.sizeType === "none");
          return {
            ...variant,
            size_id: oneSize?.id ?? "",
            size_label: oneSize?.label ?? "",
          };
        }
        return { ...variant, size_id: "", size_label: "" };
      }),
    );
  };

  const addVariant = () => {
    setVariants((current) => [
      ...current,
      {
        draft_id: createVariantDraftId(),
        sku: createDraftSku(),
        size_id: sizeOptions.find((size) => size.sizeType === sizeType)?.id ?? "",
        size_label: sizeOptions.find((size) => size.sizeType === sizeType)?.label ?? "",
        salePrice: "",
        unitCost: "",
        stock: "1",
      },
    ]);
  };

  const removeVariant = (index: number) => {
    setVariants((current) =>
      current.length > 1 ? current.filter((_, i) => i !== index) : current,
    );
  };

  const updateVariant = (index: number, field: keyof VariantDraft, value: string) => {
    setVariants((current) =>
      current.map((variant, i) =>
        i === index ? { ...variant, [field]: value } : variant,
      ),
    );
  };

  const updateVariantSize = (index: number, sizeId: string) => {
    const option = sizeOptions.find((size) => size.id === sizeId);
    setVariants((current) =>
      current.map((variant, i) =>
        i === index
          ? {
              ...variant,
              size_id: sizeId,
              size_label: option?.label ?? "",
            }
          : variant,
      ),
    );
  };

  const handleVariantDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return;
    }

    setVariants((current) => {
      const oldIndex = current.findIndex(
        (variant) => variant.draft_id === String(active.id),
      );
      const newIndex = current.findIndex(
        (variant) => variant.draft_id === String(over.id),
      );

      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        return current;
      }

      return arrayMove(current, oldIndex, newIndex);
    });
  };

  const sizeSelectOptions = (type: SizeType) => [
    { value: "", label: "Select..." },
    ...sizeOptions
      .filter((size) => size.sizeType === type)
      .map((size) => ({ value: size.id, label: size.label })),
  ];

  const addImageEntry = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    setImages((current) =>
      normalizeImages([
        ...current,
        {
          url: trimmed,
          sort_order: current.length,
          is_primary: current.length === 0,
        },
      ]),
    );
  };

  const removeImage = (index: number) => {
    setImages((current) => normalizeImages(current.filter((_, i) => i !== index)));
  };

  const setPrimaryImage = (index: number) => {
    setImages((current) =>
      normalizeImages(
        current.map((image, i) => ({
          ...image,
          is_primary: i === index,
        })),
      ),
    );
  };

  // OPTIMIZATION: Lazy load compression and memoize function
  const compressImage = useCallback(async (file: File): Promise<File> => {
    if (file.size < 1 * 1024 * 1024) {
      console.info(
        "[compressImage] File already small, skipping compression:",
        file.size,
      );
      return file;
    }

    console.info("[compressImage] Compressing file:", {
      name: file.name,
      originalSize: file.size,
      originalType: file.type,
    });

    try {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const compression = async () => {
          const imageCompression = await loadImageCompression();
          if (controller.signal.aborted) return file;
          const options = {
            signal: controller.signal,
            maxSizeMB: 2,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
            fileType: file.type || "image/jpeg",
          };

          return imageCompression.default(file, options);
        };
        // Compression is optional and library loading may ignore cancellation. Upload exactly one file.
        const compressedFile = await Promise.race([
          compression(),
          new Promise<File>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(file);
            }, 15000);
          }),
        ]);

        console.info("[compressImage] Compression successful:", {
          originalSize: file.size,
          compressedSize: compressedFile.size,
          reduction: `${Math.round((1 - compressedFile.size / file.size) * 100)}%`,
        });

        return compressedFile;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      console.error("[compressImage] Compression failed, using original:", error);
      logError(error, {
        layer: "frontend",
        event: "image_compression_failed",
        fileName: file.name,
        fileSize: file.size,
      });
      return file;
    }
  }, []);

  const validateAndPrepareFiles = (
    fileList: FileList,
  ): {
    valid: File[];
    errors: string[];
  } => {
    const valid: File[] = [];
    const errors: string[] = [];
    const MAX_SIZE = 10 * 1024 * 1024;
    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

    const filesArray = Array.from(fileList);
    console.info("[validateAndPrepareFiles] Validating", filesArray.length, "files");

    filesArray.forEach((file, index) => {
      console.info(`[validateAndPrepareFiles] File ${index + 1}:`, {
        name: file.name,
        type: file.type || "NO TYPE",
        size: file.size,
      });

      const fileName = file.name.toLowerCase();

      if (fileName.endsWith(".heic") || fileName.endsWith(".heif")) {
        errors.push(
          `${file.name}: HEIC/HEIF not supported. Please convert to JPG in Photos app first.`,
        );
        return;
      }

      if (file.size === 0) {
        errors.push(`${file.name}: File is empty`);
        return;
      }

      if (file.size > MAX_SIZE) {
        errors.push(`${file.name}: File too large (max 10MB)`);
        return;
      }

      const hasValidType = file.type && ALLOWED_TYPES.includes(file.type);
      const hasValidExtension = /\.(jpe?g|png|webp)$/i.test(fileName);

      if (!hasValidType && !hasValidExtension) {
        errors.push(`${file.name}: Not a supported image type (use JPG, PNG, or WebP)`);
        return;
      }

      if (!file.type && hasValidExtension) {
        console.info(
          `[validateAndPrepareFiles] iOS file detected (no MIME type), accepting based on extension`,
        );
      }

      valid.push(file);
    });

    console.info("[validateAndPrepareFiles] Result:", {
      valid: valid.length,
      errors: errors.length,
    });

    return { valid, errors };
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (onCheckSave || !files || files.length === 0) {
      return;
    }

    console.info("[ProductForm] Received", files.length, "file(s) for upload");
    console.info("[ProductForm] User agent:", navigator.userAgent);

    const fileArray = Array.from(files);
    console.info("[ProductForm] Converted to array, length:", fileArray.length);

    const { valid, errors } = validateAndPrepareFiles(files);

    if (errors.length > 0) {
      console.error("[ProductForm] Validation errors:", errors);
      setToast({
        message: errors.join("; "),
        tone: "error",
      });

      if (valid.length === 0) {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        setIsDragging(false);
        return;
      }
    }

    let failedFiles = 0;
    setUploadQueue({
      total: valid.length,
      completed: 0,
      failed: 0,
      isUploading: true,
    });

    console.info(
      "[ProductForm] Starting queue upload for",
      valid.length,
      "valid file(s)",
    );

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];

      try {
        console.info(`[ProductForm] Uploading file ${i + 1}/${valid.length}:`, {
          name: file.name,
          type: file.type,
          size: file.size,
        });

        const compressedFile = await compressImage(file);

        console.info(
          `[ProductForm] Uploading compressed file ${i + 1}/${valid.length}:`,
          {
            name: compressedFile.name,
            type: compressedFile.type,
            size: compressedFile.size,
          },
        );

        const fd = new FormData();
        fd.append("file", compressedFile, file.name);

        if (initialData?.id) {
          fd.append("productId", initialData.id);
        }

        const { response: res, data: json } = await adminCommand<unknown>(
          "/api/admin/uploads/product-image",
          { method: "POST", body: fd },
        );
        if (!res.ok) {
          const errorMsg = isUploadErrorResponse(json)
            ? json.error || json.message
            : "Image upload failed";
          throw new Error(errorMsg);
        }

        const uploads = (isUploadsResponse(json) ? json.uploads : [json])
          .filter(isUploadResult)
          .filter((upload) => upload.url.trim());
        if (!uploads.length) throw new Error("Upload response did not contain an image.");
        uploads.forEach((upload) => addImageEntry(upload.url));
        setUploadQueue((prev) => ({
          ...prev,
          completed: prev.completed + 1,
        }));
      } catch (error) {
        failedFiles++;
        console.error(`[ProductForm] Upload failed for ${file.name}:`, error);

        logError(error, {
          layer: "frontend",
          event: "inventory_image_upload_queue",
          fileName: file.name,
          fileIndex: i,
          userAgent: navigator.userAgent,
        });

        setUploadQueue((prev) => ({
          ...prev,
          failed: prev.failed + 1,
          completed: prev.completed + 1,
        }));
      }
    }

    const successCount = valid.length - failedFiles;
    setUploadQueue((prev) => ({ ...prev, isUploading: false }));
    setToast(
      failedFiles === 0
        ? { message: `${successCount} image(s) uploaded successfully`, tone: "success" }
        : successCount === 0
          ? { message: `All ${failedFiles} upload(s) failed`, tone: "error" }
          : { message: `${successCount} succeeded, ${failedFiles} failed`, tone: "info" },
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setIsDragging(false);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!saved && !onCheckSave)
      void work.run(() => {
        setWorkKind("upload");
        return handleUploadFiles(event.dataTransfer.files);
      });
  };

  const applyBrandOverride = (option: CatalogOption | null) => {
    setBrandOverrideId(option?.id ?? null);
    setBrandOverrideInput(option?.label ?? "");
    setModelOverrideId(null);
    setModelOverrideInput("");
  };

  const applyModelOverride = (option: CatalogOption | null) => {
    setModelOverrideId(option?.id ?? null);
    setModelOverrideInput(option?.label ?? "");
  };

  const handleBrandOverrideChange = (value: string) => {
    setBrandOverrideInput(value);
    const match = brandOptions.find(
      (option) => option.label.toLowerCase() === value.trim().toLowerCase(),
    );
    if (match) {
      applyBrandOverride(match);
    } else {
      setBrandOverrideId(null);
      setModelOverrideId(null);
      setModelOverrideInput("");
    }
  };

  const handleModelOverrideChange = (value: string) => {
    setModelOverrideInput(value);
    const match = modelOptions.find(
      (option) => option.label.toLowerCase() === value.trim().toLowerCase(),
    );
    if (match) {
      applyModelOverride(match);
    } else {
      setModelOverrideId(null);
    }
  };

  const brandSuggestion = parseResult?.suggestions?.brand;
  const modelSuggestion = parseResult?.suggestions?.model;

  const applyBrandSuggestion = () => {
    if (!brandSuggestion) {
      return;
    }
    const match = brandOptions.find((option) => option.id === brandSuggestion.id);
    if (match) {
      applyBrandOverride(match);
    }
  };

  const applyModelSuggestion = () => {
    if (!modelSuggestion) {
      return;
    }
    const match = modelOptions.find((option) => option.id === modelSuggestion.id);
    if (match) {
      applyModelOverride(match);
    }
  };

  const parseMoneyToCents = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.round(parsed * 100);
  };

  const parseStockCount = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.max(parsed, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading || saved || onCheckSave) return;
    setFieldError(null);

    function invalid(key: string, message: string): never {
      setFieldError({ key, message });
      document.getElementById(key)?.focus();
      throw new Error(message);
    }
    try {
      const trimmedTitle = titleRaw.trim();
      if (!trimmedTitle) {
        invalid(`${id}-titleRaw`, "Full title is required.");
      }
      if (!effectiveBrandId) {
        invalid(`${id}-brandOverrideInput`, "Select a canonical brand.");
      }

      const seenSizeKeys = new Set<string>();
      const preparedVariants = variants.map((variant, index) => {
        const priceCents = parseMoneyToCents(variant.salePrice);
        if (priceCents === null) {
          invalid(
            `${id}-${variant.draft_id}-salePrice`,
            `Variant ${index + 1} price is invalid.`,
          );
        }

        const trimmedUnitCost = variant.unitCost.trim();
        const costCents = trimmedUnitCost ? parseMoneyToCents(trimmedUnitCost) : null;
        if (trimmedUnitCost && costCents === null) {
          invalid(
            `${id}-${variant.draft_id}-unitCost`,
            `Variant ${index + 1} cost is invalid.`,
          );
        }

        const stockCount = parseStockCount(variant.stock);
        if (stockCount === null) {
          invalid(
            `${id}-${variant.draft_id}-stock`,
            `Variant ${index + 1} stock is invalid.`,
          );
        }

        const sizeLabel = variant.size_label.trim();
        if (!variant.size_id || !sizeLabel) {
          invalid(
            `${id}-${variant.draft_id}-size_id`,
            `Variant ${index + 1} size is required.`,
          );
        }
        const sizeKey = variant.size_id;
        if (seenSizeKeys.has(sizeKey)) {
          invalid(
            `${id}-${variant.draft_id}-size_id`,
            `Duplicate size "${sizeLabel}" found in variants.`,
          );
        }
        seenSizeKeys.add(sizeKey);

        return {
          ...(variant.id ? { id: variant.id } : {}),
          sku: variant.sku,
          size_id: variant.size_id,
          sale_price_cents: priceCents,
          ...(costCents === null ? {} : { unit_cost_cents: costCents }),
          stock: stockCount,
          sort_order: index,
        };
      });

      const preparedImages = normalizeImages(images)
        .map((image) => ({
          url: image.url.trim(),
          sort_order: image.sort_order,
          is_primary: image.is_primary,
        }))
        .filter((image) => image.url);

      let goLiveAt = new Date().toISOString();
      if (publishMode === "scheduled") {
        const value = scheduledGoLiveAt.trim();
        if (!value) {
          invalid(`${id}-scheduledGoLiveAt`, "Please choose a go-live date and time.");
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          invalid(`${id}-scheduledGoLiveAt`, "Go-live date/time is invalid.");
        }
        const nowMinute = new Date();
        nowMinute.setSeconds(0, 0);
        if (parsed.getTime() < nowMinute.getTime()) {
          invalid(`${id}-scheduledGoLiveAt`, "Go-live date/time cannot be in the past.");
        }
        goLiveAt = parsed.toISOString();
      }

      const data: ProductCreateInput = {
        name: trimmedTitle,
        brand_id: effectiveBrandId,
        model_id: effectiveModelId,
        category,
        condition,
        size_type: sizeType,
        description: description || undefined,
        go_live_at: goLiveAt,
        variants: preparedVariants,
        images: preparedImages,
      };

      await onSubmit(data);
      setSaved(true);
      setToast({ message: "Product saved.", tone: "success" });
    } catch (error) {
      logError(error, { layer: "frontend", event: "inventory_form_submit" });
      const message = error instanceof Error ? error.message : "Failed to save product";
      setToast({ message, tone: "error" });
    }
  };

  return (
    <form
      data-admin-form
      onSubmit={(event) => {
        event.preventDefault();
        void work.run(() => {
          setWorkKind("save");
          return handleSubmit(event);
        });
      }}
      className="space-y-4 pb-24 sm:pb-0 md:space-y-6"
    >
      {fieldError && (
        <p id={`${id}-error`} role="alert">
          {fieldError.message}
        </p>
      )}
      {/* MOBILE OPTIMIZATION: Improved mobile layout */}
      <div
        inert={isLoading || saved || !!onCheckSave}
        className="rounded border border-zinc-800/70 bg-zinc-900 p-4 md:p-6"
      >
        <h2 className="mb-3 text-lg font-semibold text-white md:mb-4 md:text-xl">
          Basic Information
        </h2>

        <div className="space-y-4">
          {/* Full width title on mobile */}
          <div>
            <label
              htmlFor={`${id}-titleRaw`}
              className="mb-1 block text-sm text-gray-400"
            >
              Full Title <RequiredMark />
            </label>
            <input
              id={`${id}-titleRaw`}
              aria-invalid={fieldError?.key === `${id}-titleRaw`}
              aria-describedby={
                fieldError?.key === `${id}-titleRaw` ? `${id}-error` : undefined
              }
              type="text"
              value={titleRaw}
              onChange={(e) => {
                setTitleRaw(e.target.value);
                if (!e.target.value.trim()) {
                  setParseResult(null);
                  setParseRead(undefined);
                }
              }}
              required
              className="w-full rounded border border-zinc-800/70 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-600 md:px-4 md:text-base"
            />
            <p className="mt-2 text-xs text-gray-500">
              One input only. We parse brand, model (sneakers), and name automatically.
            </p>
          </div>

          {/* Stack category/condition on mobile */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${id}-category`}
                className="mb-1 block text-sm text-gray-400"
              >
                Category <RequiredMark />
              </label>
              <RdkSelect
                id={`${id}-category`}
                aria-invalid={fieldError?.key === `${id}-category`}
                aria-describedby={
                  fieldError?.key === `${id}-category` ? `${id}-error` : undefined
                }
                value={category}
                onChange={(v) => changeCategory(v as Category)}
                options={[
                  { value: "sneakers", label: "Sneakers" },
                  { value: "clothing", label: "Clothing" },
                  { value: "accessories", label: "Accessories" },
                  { value: "electronics", label: "Electronics" },
                ]}
              />
            </div>

            <div>
              <label
                htmlFor={`${id}-condition`}
                className="mb-1 block text-sm text-gray-400"
              >
                Condition <RequiredMark />
              </label>
              <RdkSelect
                id={`${id}-condition`}
                aria-invalid={fieldError?.key === `${id}-condition`}
                aria-describedby={
                  fieldError?.key === `${id}-condition` ? `${id}-error` : undefined
                }
                value={condition}
                onChange={(v) => setCondition(v as Condition)}
                options={[
                  { value: "new", label: "New" },
                  { value: "used", label: "Pre-owned" },
                ]}
              />
            </div>
          </div>
        </div>

        {(brandStatus === "loading" ||
          (effectiveBrandId && modelStatus === "loading")) && (
          <p role="status">Loading tag options…</p>
        )}
        {(brandStatus === "error" || (effectiveBrandId && modelStatus === "error")) && (
          <p role="alert">
            Tag options unavailable.{" "}
            <button type="button" onClick={() => retryCatalog((n) => n + 1)}>
              Retry tag options
            </button>
          </p>
        )}
        {/* Parsed Preview - Collapsible on mobile */}
        <div className="mt-4 space-y-3 rounded border border-zinc-800/70 bg-zinc-950/40 p-3 md:p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-300">Parsed Preview</h3>
            {parseStatus === "loading" && (
              <span role="status" className="text-xs text-gray-500">
                Parsing...
              </span>
            )}
            {parseStatus === "error" && (
              <span role="alert" className="text-xs text-red-400">
                Unable to parse title.{" "}
                <button type="button" onClick={() => retryParse((n) => n + 1)}>
                  Retry parsing
                </button>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3 md:gap-3">
            <div className="text-gray-400">
              <span className="block text-xs uppercase text-gray-500">Brand</span>
              <span className="text-white">{parseResult?.brand?.label || "-"}</span>
            </div>
            {category === "sneakers" && (
              <div className="text-gray-400">
                <span className="block text-xs uppercase text-gray-500">Model</span>
                <span className="text-white">{parseResult?.model?.label || "-"}</span>
              </div>
            )}
            <div className="text-gray-400">
              <span className="block text-xs uppercase text-gray-500">Name</span>
              <span className="text-white">{parseResult?.name || "-"}</span>
            </div>
          </div>

          {parseResult?.titleDisplay && (
            <div className="text-xs text-gray-500">
              Display: <span className="text-gray-200">{parseResult.titleDisplay}</span>
            </div>
          )}

          {(brandSuggestion || modelSuggestion) && (
            <div className="flex flex-wrap gap-2">
              {brandSuggestion && (
                <button
                  type="button"
                  onClick={applyBrandSuggestion}
                  className="rounded-full border border-zinc-700/70 px-3 py-1 text-xs text-red-200 hover:bg-red-900/30"
                >
                  Did you mean {brandSuggestion.label}?
                </button>
              )}
              {category === "sneakers" && modelSuggestion && (
                <button
                  type="button"
                  onClick={applyModelSuggestion}
                  className="rounded-full border border-zinc-700/70 px-3 py-1 text-xs text-red-200 hover:bg-red-900/30"
                >
                  Did you mean {modelSuggestion.label}?
                </button>
              )}
            </div>
          )}
        </div>

        {/* Stack overrides on mobile */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${id}-brandOverrideInput`}
              className="mb-1 block text-sm text-gray-400"
            >
              Override Brand
            </label>
            <input
              id={`${id}-brandOverrideInput`}
              aria-invalid={fieldError?.key === `${id}-brandOverrideInput`}
              aria-describedby={
                fieldError?.key === `${id}-brandOverrideInput` ? `${id}-error` : undefined
              }
              type="text"
              list={`${id}-brand-options`}
              value={brandOverrideInput}
              onChange={(e) => handleBrandOverrideChange(e.target.value)}
              placeholder="Search brands..."
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10 md:px-4 md:text-base"
            />
            <datalist id={`${id}-brand-options`}>
              {brandOptions.map((brand) => (
                <option key={brand.id} value={brand.label} />
              ))}
            </datalist>
            {brandOverrideId && (
              <button
                type="button"
                onClick={() => applyBrandOverride(null)}
                className="mt-2 text-xs text-gray-500 hover:text-white"
              >
                Clear override
              </button>
            )}
          </div>

          {category === "sneakers" && (
            <div>
              <label
                htmlFor={`${id}-modelOverrideInput`}
                className="mb-1 block text-sm text-gray-400"
              >
                Override Model
              </label>
              <input
                id={`${id}-modelOverrideInput`}
                aria-invalid={fieldError?.key === `${id}-modelOverrideInput`}
                aria-describedby={
                  fieldError?.key === `${id}-modelOverrideInput`
                    ? `${id}-error`
                    : undefined
                }
                type="text"
                list={`${id}-model-options`}
                value={modelOverrideInput}
                onChange={(e) => handleModelOverrideChange(e.target.value)}
                placeholder={
                  effectiveBrandId ? "Search models..." : "Select a brand first"
                }
                disabled={!effectiveBrandId || modelStatus !== "idle"}
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10 disabled:bg-zinc-100 disabled:text-zinc-400 md:px-4 md:text-base"
              />
              <datalist id={`${id}-model-options`}>
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.label} />
                ))}
              </datalist>
              {modelOverrideId && (
                <button
                  type="button"
                  onClick={() => applyModelOverride(null)}
                  className="mt-2 text-xs text-gray-500 hover:text-white"
                >
                  Clear override
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-4">
          <label
            htmlFor={`${id}-description`}
            className="mb-1 block text-sm text-gray-400"
          >
            Description
          </label>
          <textarea
            id={`${id}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded border border-zinc-800/70 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-600 md:px-4 md:text-base"
          />
        </div>
      </div>

      {/* Variants - Better mobile layout */}
      <div
        inert={isLoading || saved || !!onCheckSave}
        className="rounded border border-zinc-800/70 bg-zinc-900 p-4 md:p-6"
      >
        <div className="mb-3 flex items-center justify-between md:mb-4">
          <h2 className="text-lg font-semibold text-white md:text-xl">Variants</h2>
          <button
            type="button"
            onClick={addVariant}
            className="flex items-center gap-1 rounded bg-red-600 px-2 py-1.5 text-xs text-white transition hover:bg-red-700 md:gap-2 md:px-3 md:py-2 md:text-sm"
          >
            <Plus className="h-3 w-3 md:h-4 md:w-4" />
            <span className="hidden sm:inline">Add Variant</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
        <DndContext
          id={`${id}-variants`}
          sensors={variantDragSensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleVariantDragEnd}
        >
          <SortableContext items={variantIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3 md:space-y-4">
              {variants.map((variant, index) => (
                <SortableVariantRow
                  key={variant.draft_id}
                  id={variant.draft_id}
                  className="transition-transform duration-200"
                >
                  {({
                    attributes,
                    listeners,
                    setActivatorNodeRef,
                    isDragging: isVariantDragging,
                    isOver: isVariantOver,
                  }) => (
                    <div
                      className={[
                        "relative flex flex-col gap-3 rounded bg-zinc-800 p-3 transition-[box-shadow,opacity] duration-150 md:flex-row md:items-end md:gap-4 md:p-4",
                        isVariantDragging ? "opacity-65 shadow-2xl" : "",
                        isVariantOver ? "ring-2 ring-red-500/50" : "",
                      ].join(" ")}
                    >
                      {/* Fields: wrap-flow of fixed-width inputs so nothing stretches */}
                      <div className="flex flex-1 flex-col gap-3 md:flex-row md:flex-wrap md:gap-4">
                        <div className="w-full md:w-32">
                          <label
                            htmlFor={`${id}-${variant.draft_id}-sku`}
                            className="mb-1 block text-xs text-gray-400"
                          >
                            SKU
                          </label>
                          <input
                            id={`${id}-${variant.draft_id}-sku`}
                            aria-invalid={
                              fieldError?.key === `${id}-${variant.draft_id}-sku`
                            }
                            aria-describedby={
                              fieldError?.key === `${id}-${variant.draft_id}-sku`
                                ? `${id}-error`
                                : undefined
                            }
                            type="text"
                            value={variant.sku}
                            readOnly
                            aria-readonly="true"
                            tabIndex={-1}
                            title="SKU is generated automatically and cannot be edited"
                            className="w-full cursor-not-allowed select-none rounded border border-zinc-800/70 bg-zinc-900 px-2 py-2 font-mono text-xs text-zinc-400 focus:outline-none focus:ring-0 md:px-3 md:text-sm"
                          />
                        </div>

                        <div className="w-full md:w-40">
                          <label
                            htmlFor={`${id}-${variant.draft_id}-size_id`}
                            className="mb-1 block text-xs text-gray-400"
                          >
                            Size <RequiredMark />
                          </label>

                          <RdkSelect
                            id={`${id}-${variant.draft_id}-size_id`}
                            aria-invalid={
                              fieldError?.key === `${id}-${variant.draft_id}-size_id`
                            }
                            aria-describedby={
                              fieldError?.key === `${id}-${variant.draft_id}-size_id`
                                ? `${id}-error`
                                : undefined
                            }
                            value={variant.size_id}
                            onChange={(value) => updateVariantSize(index, value)}
                            placeholder="Select..."
                            searchable={sizeType !== "none"}
                            searchPlaceholder="Search sizes..."
                            options={sizeSelectOptions(sizeType)}
                          />
                        </div>

                        <div className="w-full md:w-32">
                          <label
                            htmlFor={`${id}-${variant.draft_id}-salePrice`}
                            className="mb-1 block text-xs text-gray-400"
                          >
                            Sale Price ($) <RequiredMark />
                          </label>
                          <input
                            id={`${id}-${variant.draft_id}-salePrice`}
                            aria-invalid={
                              fieldError?.key === `${id}-${variant.draft_id}-salePrice`
                            }
                            aria-describedby={
                              fieldError?.key === `${id}-${variant.draft_id}-salePrice`
                                ? `${id}-error`
                                : undefined
                            }
                            type="text"
                            inputMode="decimal"
                            value={variant.salePrice}
                            onChange={(e) =>
                              updateVariant(index, "salePrice", e.target.value)
                            }
                            required
                            className="w-full rounded border border-zinc-800/70 bg-zinc-900 px-2 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-red-600 md:px-3 md:text-sm"
                          />
                        </div>

                        <div className="w-full md:w-32">
                          <label
                            htmlFor={`${id}-${variant.draft_id}-unitCost`}
                            className="mb-1 block text-xs text-gray-400"
                          >
                            Unit Cost ($){" "}
                            <span className="text-zinc-500">(Optional)</span>
                          </label>
                          <input
                            id={`${id}-${variant.draft_id}-unitCost`}
                            aria-invalid={
                              fieldError?.key === `${id}-${variant.draft_id}-unitCost`
                            }
                            aria-describedby={
                              fieldError?.key === `${id}-${variant.draft_id}-unitCost`
                                ? `${id}-error`
                                : undefined
                            }
                            type="text"
                            inputMode="decimal"
                            value={variant.unitCost}
                            onChange={(e) =>
                              updateVariant(index, "unitCost", e.target.value)
                            }
                            placeholder="Optional"
                            className="w-full rounded border border-zinc-800/70 bg-zinc-900 px-2 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-red-600 md:px-3 md:text-sm"
                          />
                        </div>

                        <div className="w-full md:w-24">
                          <label
                            htmlFor={`${id}-${variant.draft_id}-stock`}
                            className="mb-1 block text-xs text-gray-400"
                          >
                            Stock <RequiredMark />
                          </label>
                          <input
                            id={`${id}-${variant.draft_id}-stock`}
                            aria-invalid={
                              fieldError?.key === `${id}-${variant.draft_id}-stock`
                            }
                            aria-describedby={
                              fieldError?.key === `${id}-${variant.draft_id}-stock`
                                ? `${id}-error`
                                : undefined
                            }
                            type="text"
                            inputMode="numeric"
                            value={variant.stock}
                            onChange={(e) =>
                              updateVariant(index, "stock", e.target.value)
                            }
                            required
                            className="w-full rounded border border-zinc-800/70 bg-zinc-900 px-2 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-red-600 md:px-3 md:text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1 self-end md:h-[42px]">
                        <button
                          ref={setActivatorNodeRef}
                          type="button"
                          {...attributes}
                          {...listeners}
                          className="cursor-grab touch-none rounded p-2 text-zinc-300 hover:bg-zinc-900 hover:text-white active:cursor-grabbing"
                          aria-label="Drag to reorder variant"
                          title="Drag to reorder"
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                        {variants.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeVariant(index)}
                            className="rounded p-2 text-red-500 hover:bg-zinc-900 hover:text-red-400"
                            aria-label="Remove variant"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </SortableVariantRow>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Images - Mobile optimized */}
      <div
        inert={isLoading || saved || !!onCheckSave}
        className="rounded border border-zinc-800/70 bg-zinc-900 p-4 md:p-6"
      >
        <div className="mb-3 flex items-center justify-between md:mb-4">
          <h2 className="text-lg font-semibold text-white md:text-xl">
            Images (optional)
          </h2>
          <span className="text-xs text-gray-500">{images.length} total</span>
        </div>

        {uploadQueue.isUploading && (
          <span role="status">
            {uploadQueue.currentStatus} · {uploadQueue.completed} of {uploadQueue.total}{" "}
            processed
          </span>
        )}
        {uploadQueue.isUploading && (
          <div className="mb-4 rounded border border-blue-800/50 bg-blue-900/20 p-3 md:p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-200 md:text-sm">
                {uploadQueue.currentStatus || "Uploading images..."}
              </span>
              <span className="text-xs text-blue-300">
                {uploadQueue.completed} / {uploadQueue.total}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{
                  width: `${(uploadQueue.completed / uploadQueue.total) * 100}%`,
                }}
              />
            </div>
            {uploadQueue.failed > 0 && (
              <p className="mt-2 text-xs text-red-400">
                {uploadQueue.failed} upload(s) failed
              </p>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          disabled={!!onCheckSave || work.pending || saved}
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => {
            console.info(
              "[ProductForm] File input changed, files:",
              e.target.files?.length || 0,
            );
            if (e.target.files) {
              console.info(
                "[ProductForm] File details:",
                Array.from(e.target.files).map((f) => ({
                  name: f.name,
                  type: f.type,
                  size: f.size,
                })),
              );
            }
            const files = e.target.files;
            if (!saved && !onCheckSave)
              void work.run(() => {
                setWorkKind("upload");
                return handleUploadFiles(files);
              });
          }}
          className="hidden"
        />

        {/* Mobile-friendly dropzone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Add product images"
          aria-disabled={uploading || isLoading || saved}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              !uploading &&
              !isLoading &&
              !saved
            ) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onClick={() => {
            if (!uploading && !isLoading && !saved) fileInputRef.current?.click();
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            "h-32 w-full cursor-pointer border border-dashed transition md:h-44",
            "flex flex-col items-center gap-2 rounded px-3 py-3 sm:flex-row md:gap-3 md:px-4",
            isDragging
              ? "border-red-500 bg-red-900/10"
              : "border-zinc-800/70 bg-zinc-950/30 hover:bg-zinc-950/50",
          ].join(" ")}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-800/70 bg-zinc-900 md:h-10 md:w-10">
            <ImagePlus className="h-4 w-4 text-gray-400 md:h-5 md:w-5" />
          </div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-xs font-semibold text-white md:text-sm">
              Tap to add images
            </p>
            <p className="mt-1 text-xs text-gray-500">PNG, JPG, WEBP. Max 10MB each.</p>
          </div>
        </div>

        {/* Mobile-friendly image grid */}
        <div className="mt-3 md:mt-4">
          {images.length === 0 ? (
            <div className="text-xs text-gray-500 md:text-sm">No images yet.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 md:gap-3">
              {images.map((image, index) => (
                <div
                  key={index}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPrimaryImage(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPrimaryImage(index);
                    }
                  }}
                  className={[
                    "group relative overflow-hidden border text-left transition",
                    "cursor-pointer select-none rounded",
                    image.is_primary
                      ? "border-red-500"
                      : "border-zinc-800/70 hover:border-zinc-700",
                  ].join(" ")}
                  title="Tap to set primary"
                >
                  <div className="aspect-square overflow-hidden bg-zinc-900">
                    {image.url ? (
                      <img
                        src={image.url}
                        alt="Preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
                        Missing
                      </div>
                    )}
                  </div>

                  <div className="absolute left-1 top-1">
                    <span
                      className={[
                        "rounded border px-1.5 py-0.5 text-[9px] md:px-2 md:text-[10px]",
                        image.is_primary
                          ? "border-red-500 bg-red-600 text-white"
                          : "border-white/10 bg-black/50 text-gray-200",
                      ].join(" ")}
                    >
                      {image.is_primary ? "Primary" : "Thumb"}
                    </span>
                  </div>

                  <div className="absolute right-1 top-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(index);
                      }}
                      className="rounded bg-black/60 p-1 text-white hover:bg-black/80 md:p-1.5"
                      aria-label="Remove image"
                    >
                      <X className="h-3 w-3 md:h-3.5 md:w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 text-xs text-gray-500 md:mt-3">
          Images are optional. Tap any thumbnail to set as primary.
        </div>
      </div>

      <div
        inert={isLoading || saved || !!onCheckSave}
        className="rounded border border-zinc-800/70 bg-zinc-900 p-4 md:p-6"
      >
        <h2 className="mb-2 text-lg font-semibold text-white md:text-xl">
          Posting Schedule
        </h2>
        <p className="text-xs text-gray-400 md:text-sm">
          Products post immediately by default. Switch to scheduled posting to pick a
          future go-live date and time.
        </p>

        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer select-none items-center gap-3 text-sm text-white">
            <input
              type="radio"
              name="publish-mode"
              checked={publishMode === "immediately"}
              onChange={() => setPublishMode("immediately")}
              className="h-4 w-4 cursor-pointer accent-red-600"
            />
            <span>Post immediately</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-3 text-sm text-white">
            <input
              type="radio"
              name="publish-mode"
              checked={publishMode === "scheduled"}
              onChange={() => {
                setPublishMode("scheduled");
                ensureScheduledTime();
              }}
              className="h-4 w-4 cursor-pointer accent-red-600"
            />
            <span>Schedule date and time</span>
          </label>
        </div>

        <div className="mt-4">
          <label
            htmlFor={`${id}-scheduledGoLiveAt`}
            className="mb-1 block text-sm text-gray-400"
          >
            Go Live Date & Time
            {publishMode === "scheduled" && (
              <>
                {" "}
                <RequiredMark />
              </>
            )}
          </label>
          <input
            id={`${id}-scheduledGoLiveAt`}
            aria-invalid={fieldError?.key === `${id}-scheduledGoLiveAt`}
            aria-describedby={
              fieldError?.key === `${id}-scheduledGoLiveAt` ? `${id}-error` : undefined
            }
            type="datetime-local"
            value={scheduledGoLiveAt}
            min={scheduleMin}
            disabled={publishMode !== "scheduled"}
            onChange={(event) => setScheduledGoLiveAt(event.target.value)}
            className="w-full rounded border border-zinc-800/70 bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto md:px-4 md:text-base"
          />
          <p className="mt-2 text-xs text-gray-500">
            {publishMode === "scheduled"
              ? "This uses your local timezone and converts to UTC when saved."
              : "Posting immediately. Choose 'Schedule date and time' to enable this field."}
          </p>
        </div>
      </div>

      {/* Actions - Mobile friendly */}
      <div
        data-admin-form-actions
        className="fixed inset-x-0 bottom-0 flex gap-2 border-t border-zinc-800 bg-black p-4 sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0 md:gap-4"
      >
        <ActionButton
          pending={isLoading}
          pendingLabel={onCheckSave ? "Checking…" : "Saving…"}
          type={onCheckSave ? "button" : "submit"}
          onClick={
            onCheckSave
              ? () =>
                  void work.run(async () => {
                    setWorkKind("save");
                    try {
                      await onCheckSave();
                      setSaved(true);
                    } catch (error) {
                      setToast({
                        message:
                          error instanceof Error
                            ? error.message
                            : "Unable to check inventory.",
                        tone: "error",
                      });
                    }
                  })
              : undefined
          }
          disabled={uploading || saved}
          className="admin-button-primary flex-1 py-3 disabled:border-zinc-300 disabled:bg-zinc-300 disabled:text-zinc-500"
        >
          {onCheckSave
            ? "Check inventory"
            : initialData?.id
              ? "Update Product"
              : "Create Product"}
        </ActionButton>
        <button
          type="button"
          disabled={isLoading || uploading}
          onClick={onCancel}
          className="rounded bg-zinc-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-600 md:text-base"
        >
          Cancel
        </button>
      </div>

      <Toast
        open={Boolean(toast)}
        message={toast?.message ?? ""}
        tone={toast?.tone ?? "info"}
        onClose={() => setToast(null)}
      />
    </form>
  );
}
