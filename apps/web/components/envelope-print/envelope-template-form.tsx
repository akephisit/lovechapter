import {
  ENVELOPE_PRESETS,
  type EnvelopeTemplateInput,
} from "@lovechapter/contracts";
import { useUiCopy } from "../ui-language-provider";

const integerFields = [
  ["widthMm", 90, 330],
  ["heightMm", 55, 480],
  ["marginTopMm", 0, 480],
  ["marginRightMm", 0, 480],
  ["marginBottomMm", 0, 480],
  ["marginLeftMm", 0, 480],
  ["fontSizePt", 8, 72],
  ["lineSpacingPercent", 80, 250],
] as const;

export function EnvelopeTemplateForm({
  value,
  onChange,
}: {
  value: EnvelopeTemplateInput;
  onChange(value: EnvelopeTemplateInput): void;
}) {
  const copy = useUiCopy();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">
        {copy.envelope.templateName}
        <input
          className="rounded border p-2"
          maxLength={80}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <label className="grid gap-1 text-sm">
        {copy.envelope.size}
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
          <option value="custom">{copy.envelope.custom}</option>
        </select>
      </label>
      {integerFields.map(([field, min, max]) => (
        <label className="grid gap-1 text-sm" key={field}>
          {copy.envelope[field]}
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
        {copy.envelope.orientation}
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
          <option value="landscape">{copy.envelope.landscape}</option>
          <option value="portrait">{copy.envelope.portrait}</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {copy.envelope.alignment}
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
          <option value="left">{copy.envelope.left}</option>
          <option value="center">{copy.envelope.center}</option>
          <option value="right">{copy.envelope.right}</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        {copy.envelope.font}
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
        {copy.envelope.showAddress}
      </label>
    </div>
  );
}
