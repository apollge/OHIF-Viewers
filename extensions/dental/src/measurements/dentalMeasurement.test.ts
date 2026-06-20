import { createDentalMeasurement, updateDentalMeasurement } from './dentalMeasurement';
import { getDentalMeasurementPreset } from './dentalMeasurementPresets';

describe('dental measurement records', () => {
  it('keeps the fixed preset label separate from the optional note', () => {
    const record = createDentalMeasurement({
      measurement: {
        uid: 'annotation-1',
        toolName: 'Length',
        data: { image: { length: 12.4, unit: 'mm' } },
        metadata: {
          referencedImageId: 'wadors:image-1',
          FrameOfReferenceUID: 'frame-1',
        },
      },
      preset: getDentalMeasurementPreset('pa-length'),
      toothId: 'permanent-1',
      note: 'Distal root',
      viewReference: {
        FrameOfReferenceUID: 'frame-1',
        referencedImageId: 'wadors:image-1',
        cameraFocalPoint: new Float32Array([1, 2, 3]),
        viewPlaneNormal: new Float32Array([0, 0, 1]),
        viewUp: new Float32Array([0, -1, 0]),
      },
      createdAt: '2026-06-18T00:00:00.000Z',
    });

    expect(record).toEqual(
      expect.objectContaining({
        annotationUID: 'annotation-1',
        label: 'PA length',
        unit: 'mm',
        value: 12.4,
        note: 'Distal root',
        referencedImageId: 'wadors:image-1',
        FrameOfReferenceUID: 'frame-1',
        viewReference: expect.objectContaining({
          cameraFocalPoint: [1, 2, 3],
          viewPlaneNormal: [0, 0, 1],
          viewUp: [0, -1, 0],
        }),
      })
    );
  });

  it('updates the value for the same annotation record', () => {
    const record = createDentalMeasurement({
      measurement: {
        uid: 'annotation-1',
        toolName: 'Angle',
        data: { image: { angle: 31 } },
      },
      preset: getDentalMeasurementPreset('canal-angle'),
      toothId: 'permanent-1',
      note: '',
      createdAt: '2026-06-18T00:00:00.000Z',
    });

    const updated = updateDentalMeasurement(
      record,
      {
        uid: 'annotation-1',
        toolName: 'Angle',
        data: { image: { angle: 34.5 } },
      },
      '2026-06-18T00:01:00.000Z'
    );

    expect(updated.value).toBe(34.5);
    expect(updated.annotationUID).toBe(record.annotationUID);
    expect(updated.createdAt).toBe(record.createdAt);
  });
});
