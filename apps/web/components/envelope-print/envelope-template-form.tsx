import {
  ENVELOPE_PRESETS,
  type EnvelopeTemplateInput,
} from "@lovechapter/contracts";

const integerFields = [
  ["widthMm", "Width (mm)", 90, 330],
  ["heightMm", "Height (mm)", 55, 480],
  ["marginTopMm", "Top margin (mm)", 0, 480],
  ["marginRightMm", "Right margin (mm)", 0, 480],
  ["marginBottomMm", "Bottom margin (mm)", 0, 480],
  ["marginLeftMm", "Left margin (mm)", 0, 480],
  ["fontSizePt", "Font size (pt)", 8, 72],
  ["lineSpacingPercent", "Line spacing (%)", 80, 250],
] as const;

export function EnvelopeTemplateForm({
  value,
  onChange,
}: {
  value: EnvelopeTemplateInput;
  onChange(value: EnvelopeTemplateInput): void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">
        Template name
        <input
          className="rounded border p-2"
          maxLength={80}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Envelope size
        <select
          className="rounded border p-2"
          value={
            Object.entries(ENVELOPE_PRESETS).find(
              ([, size]) =>
                size.widthMm === value.widthMm &&
                size.heightMm === value.heightMm,
            )?.[0] ?? "custom"
          }
          onChange={(event) => {
            const size =
              ENVELOPE_PRESETS[
                event.target.value as keyof typeof ENVELOPE_PRESETS
              ];
            if (size) onChange({ ...value, ...size });
          }}
        >
          <option value="DL">DL · 220 × 110 mm</option>
          <option value="C5">C5 · 229 × 162 mm</option>
          <option value="C6">C6 · 162 × 114 mm</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {integerFields.map(([field, label, min, max]) => (
        <label className="grid gap-1 text-sm" key={field}>
          {label}
          <input
            className="rounded border p-2"
            type="number"
            min={min}
            max={max}
            step={1}
            value={Number.isNaN(value[field]) ? "" : value[field]}
            onChange={(event) =>
              onChange({
                ...value,
                [field]:
                  event.target.value === "" ? NaN : Number(event.target.value),
              })
            }
          />
        </label>
      ))}
      <label className="grid gap-1 text-sm">
        Orientation
        <select
          className="rounded border p-2"
          value={value.orientation}
          onChange={(event) =>
            onChange({
              ...value,
              orientation: event.target
                .value as EnvelopeTemplateInput["orientation"],
            })
          }
        >
          <option value="landscape">Landscape</option>
          <option value="portrait">Portrait</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Alignment
        <select
          className="rounded border p-2"
          value={value.alignment}
          onChange={(event) =>
            onChange({
              ...value,
              alignment: event.target
                .value as EnvelopeTemplateInput["alignment"],
            })
          }
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Font
        <select
          className="rounded border p-2"
          value={value.fontFamily}
          onChange={(event) =>
            onChange({
              ...value,
              fontFamily: event.target
                .value as EnvelopeTemplateInput["fontFamily"],
            })
          }
        >
          <option value="noto-sans-thai">Noto Sans Thai</option>
          <option value="noto-serif-thai">Noto Serif Thai</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.showAddress}
          onChange={(event) =>
            onChange({ ...value, showAddress: event.target.checked })
          }
        />
        Print postal address
      </label>
    </div>
  );
}
