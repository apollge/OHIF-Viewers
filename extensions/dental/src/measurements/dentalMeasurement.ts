import {
  DentalMeasurementPreset,
  DentalMeasurementPresetId,
  DentalMeasurementToolName,
} from './dentalMeasurementPresets';

export type DentalMeasurement = {
  annotationUID: string;
  presetId: DentalMeasurementPresetId;
  label: string;
  unit: DentalMeasurementPreset['unit'];
  value: number | null;
  toothId: string;
  note: string | null;
  toolName: DentalMeasurementToolName;
  referenceStudyUID?: string;
  referenceSeriesUID?: string;
  displaySetInstanceUID?: string;
  referencedImageId?: string;
  FrameOfReferenceUID?: string;
  viewReference?: DentalMeasurementViewReference;
  viewportId?: string;
  points?: number[][];
  createdAt: string;
  updatedAt: string;
};

export type DentalMeasurementViewReference = {
  FrameOfReferenceUID?: string;
  referencedImageId?: string;
  referencedImageURI?: string;
  sliceIndex?: number;
  cameraFocalPoint?: number[];
  viewPlaneNormal?: number[];
  viewUp?: number[];
  planeRestriction?: {
    FrameOfReferenceUID: string;
    point: number[];
    inPlaneVector1?: number[];
    inPlaneVector2?: number[];
  };
};

function toNumberArray(value: unknown): number[] | undefined {
  if (!value || typeof (value as ArrayLike<number>).length !== 'number') {
    return undefined;
  }

  return Array.from(value as ArrayLike<number>);
}

export function normalizeDentalViewReference(
  viewReference: Record<string, any> | undefined
): DentalMeasurementViewReference | undefined {
  if (!viewReference) {
    return undefined;
  }

  const planeRestriction = viewReference.planeRestriction;

  return {
    FrameOfReferenceUID: viewReference.FrameOfReferenceUID,
    referencedImageId: viewReference.referencedImageId,
    referencedImageURI: viewReference.referencedImageURI,
    sliceIndex: viewReference.sliceIndex,
    cameraFocalPoint: toNumberArray(viewReference.cameraFocalPoint),
    viewPlaneNormal: toNumberArray(viewReference.viewPlaneNormal),
    viewUp: toNumberArray(viewReference.viewUp),
    planeRestriction: planeRestriction
      ? {
          FrameOfReferenceUID: planeRestriction.FrameOfReferenceUID,
          point: toNumberArray(planeRestriction.point) || [],
          inPlaneVector1: toNumberArray(planeRestriction.inPlaneVector1),
          inPlaneVector2: toNumberArray(planeRestriction.inPlaneVector2),
        }
      : undefined,
  };
}

export function getMeasurementValue(measurement: Record<string, any>): number | null {
  const statistic = Object.values(measurement.data || {}).find(
    value => value && typeof value === 'object'
  ) as Record<string, unknown> | undefined;
  const value = measurement.toolName === 'Angle' ? statistic?.angle : statistic?.length;

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createDentalMeasurement({
  measurement,
  preset,
  toothId,
  note,
  viewportId,
  viewReference,
  createdAt = new Date().toISOString(),
}: {
  measurement: Record<string, any>;
  preset: DentalMeasurementPreset;
  toothId: string;
  note: string;
  viewportId?: string;
  viewReference?: Record<string, any>;
  createdAt?: string;
}): DentalMeasurement {
  const normalizedViewReference = normalizeDentalViewReference(viewReference);

  return {
    annotationUID: measurement.uid,
    presetId: preset.id,
    label: preset.label,
    unit: preset.unit,
    value: getMeasurementValue(measurement),
    toothId,
    note: note.trim() || null,
    toolName: preset.toolName,
    referenceStudyUID: measurement.referenceStudyUID,
    referenceSeriesUID: measurement.referenceSeriesUID,
    displaySetInstanceUID: measurement.displaySetInstanceUID,
    referencedImageId:
      normalizedViewReference?.referencedImageId ||
      measurement.referencedImageId ||
      measurement.metadata?.referencedImageId,
    FrameOfReferenceUID:
      normalizedViewReference?.FrameOfReferenceUID ||
      measurement.FrameOfReferenceUID ||
      measurement.metadata?.FrameOfReferenceUID,
    viewReference: normalizedViewReference,
    viewportId,
    points: measurement.points,
    createdAt,
    updatedAt: createdAt,
  };
}

export function updateDentalMeasurement(
  dentalMeasurement: DentalMeasurement,
  measurement: Record<string, any>,
  updatedAt = new Date().toISOString()
): DentalMeasurement {
  return {
    ...dentalMeasurement,
    value: getMeasurementValue(measurement),
    points: measurement.points || dentalMeasurement.points,
    updatedAt,
  };
}
