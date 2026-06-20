import { act, renderHook, waitFor } from '@testing-library/react';

import { DEFAULT_DENTAL_PREFERENCES } from '../preferences/dentalPreferences';
import { DentalMeasurementsService } from './DentalMeasurementsService';
import { useDentalMeasurements } from './useDentalMeasurements';

function createHarness(
  measurements: Record<string, unknown>[] = [],
  { viewportAvailable = true } = {}
) {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ measurements }),
  });
  const subscribers = new Map<string, (event: any) => void>();
  const lifecycleSubscribers = new Map<string, (event: any) => void>();
  let isViewportAvailable = viewportAvailable;
  const measurementService = {
    EVENTS: {
      MEASUREMENT_ADDED: 'measurementAdded',
      MEASUREMENT_UPDATED: 'measurementUpdated',
      MEASUREMENT_REMOVED: 'measurementRemoved',
    },
    subscribe: jest.fn((event, callback) => {
      subscribers.set(event, callback);
      return { unsubscribe: jest.fn() };
    }),
    getMeasurement: jest.fn(),
    update: jest.fn(),
  };
  const commandsManager = {
    runCommand: jest.fn((commandName, options) =>
      commandName === 'hydrateAnnotationForViewport'
        ? options.annotationData.annotationUID
        : undefined
    ),
  };
  const dentalMeasurementsService = new DentalMeasurementsService();
  const renderingEngine = { render: jest.fn() };
  const cornerstoneViewport = {
    getFrameOfReferenceUID: jest.fn(() => 'frame-from-viewport'),
    getImageIds: jest.fn(() => ['wadors:image-1']),
    getViewReference: jest.fn(() => ({
      FrameOfReferenceUID: 'frame-from-viewport',
      referencedImageId: 'wadors:image-1',
      referencedImageURI: 'wadors:image-1',
      sliceIndex: 0,
      cameraFocalPoint: [2, 3, 4],
      viewPlaneNormal: [0, 0, 1],
      viewUp: [0, -1, 0],
      planeRestriction: {
        FrameOfReferenceUID: 'frame-from-viewport',
        point: [1, 2, 3],
        inPlaneVector1: [0, -1, 0],
        inPlaneVector2: [1, 0, 0],
      },
    })),
    isReferenceViewable: jest.fn(() => true),
    setViewReference: jest.fn(),
    render: jest.fn(),
  };
  const cornerstoneViewportService = {
    EVENTS: {
      VIEWPORT_DATA_CHANGED: 'viewportDataChanged',
    },
    getViewportIds: jest.fn(() => ['dental-current']),
    getCornerstoneViewport: jest.fn(() => (isViewportAvailable ? cornerstoneViewport : undefined)),
    getRenderingEngine: jest.fn(() => renderingEngine),
    subscribe: jest.fn((event, callback) => {
      lifecycleSubscribers.set(event, callback);
      return { unsubscribe: jest.fn() };
    }),
  };
  const servicesManager = {
    services: {
      cornerstoneViewportService,
      dentalMeasurementsService,
      displaySetService: {
        EVENTS: {
          DISPLAY_SETS_ADDED: 'displaySetsAdded',
          DISPLAY_SETS_CHANGED: 'displaySetsChanged',
        },
        getActiveDisplaySets: jest.fn(() => [
          {
            StudyInstanceUID: 'study-1',
          },
        ]),
        subscribe: jest.fn((event, callback) => {
          lifecycleSubscribers.set(event, callback);
          return { unsubscribe: jest.fn() };
        }),
      },
      measurementService,
      viewportGridService: {
        EVENTS: {
          VIEWPORTS_READY: 'viewportsReady',
        },
        getState: jest.fn(() => ({ activeViewportId: 'dental-current' })),
        subscribe: jest.fn((event, callback) => {
          lifecycleSubscribers.set(event, callback);
          return { unsubscribe: jest.fn() };
        }),
      },
    },
  };
  const hook = renderHook(() =>
    useDentalMeasurements({
      appConfig: {
        dental: {
          measurementsApiUrl: 'http://localhost:4007/api/dental',
          measurementsAuthToken: 'token',
        },
      } as AppTypes.Config,
      commandsManager: commandsManager as never,
      servicesManager: servicesManager as never,
      preferences: DEFAULT_DENTAL_PREFERENCES,
    })
  );

  return {
    ...hook,
    commandsManager,
    dentalMeasurementsService,
    measurementService,
    cornerstoneViewport,
    emit: (event: string, payload: any) => act(() => subscribers.get(event)?.(payload)),
    emitLifecycle: (event: string, payload: any = {}) =>
      act(() => lifecycleSubscribers.get(event)?.(payload)),
    setViewportAvailable: (available: boolean) => {
      isViewportAvailable = available;
    },
    restoreFetch: () => {
      global.fetch = originalFetch;
    },
  };
}

describe('useDentalMeasurements', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
      const text = [message, ...args].join(' ');

      if (text.includes('ReactDOMTestUtils.act') && text.includes('deprecated')) {
        return;
      }

      throw new Error(text);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('arms the mapped OHIF tool and labels only the next completed annotation', () => {
    const harness = createHarness();

    act(() => harness.result.current.armPreset('pa-length', 'Distal root'));

    expect(harness.commandsManager.runCommand).toHaveBeenCalledWith('setToolActive', {
      toolName: 'Length',
    });
    harness.emit('measurementAdded', {
      measurement: {
        uid: 'annotation-1',
        toolName: 'Length',
        data: { image: { length: 18.25 } },
      },
    });

    expect(harness.measurementService.update).toHaveBeenCalledWith(
      'annotation-1',
      expect.objectContaining({
        label: 'PA length',
        unit: 'mm',
      }),
      true
    );
    expect(harness.dentalMeasurementsService.getMeasurements()[0]).toEqual(
      expect.objectContaining({
        annotationUID: 'annotation-1',
        label: 'PA length',
        value: 18.25,
        note: 'Distal root',
      })
    );

    harness.emit('measurementAdded', {
      measurement: {
        uid: 'annotation-2',
        toolName: 'Length',
        data: { image: { length: 20 } },
      },
    });

    expect(harness.dentalMeasurementsService.getMeasurements()).toHaveLength(1);
    harness.unmount();
    harness.restoreFetch();
  });

  it('updates an existing record when the annotation value changes', () => {
    const harness = createHarness();

    act(() => harness.result.current.armPreset('canal-angle'));
    harness.emit('measurementAdded', {
      measurement: {
        uid: 'annotation-1',
        toolName: 'Angle',
        data: { image: { angle: 22 } },
      },
    });
    harness.emit('measurementUpdated', {
      measurement: {
        uid: 'annotation-1',
        toolName: 'Angle',
        data: { image: { angle: 27.5 } },
      },
    });

    expect(harness.dentalMeasurementsService.getMeasurements()[0].value).toBe(27.5);
    harness.unmount();
    harness.restoreFetch();
  });

  it('keeps panel state synchronized when a measurement is deleted', () => {
    const harness = createHarness();

    act(() => harness.result.current.armPreset('root-length'));
    harness.emit('measurementAdded', {
      measurement: {
        uid: 'annotation-1',
        toolName: 'Length',
        data: { image: { length: 19 } },
      },
    });
    harness.measurementService.getMeasurement.mockReturnValue({ uid: 'annotation-1' });

    act(() => harness.dentalMeasurementsService.requestDelete('annotation-1'));

    expect(harness.commandsManager.runCommand).toHaveBeenCalledWith('removeMeasurement', {
      uid: 'annotation-1',
    });
    expect(harness.dentalMeasurementsService.getMeasurements()).toHaveLength(1);

    harness.emit('measurementRemoved', {
      measurement: { uid: 'annotation-1' },
    });

    expect(harness.dentalMeasurementsService.getMeasurements()).toEqual([]);
    harness.unmount();
    harness.restoreFetch();
  });

  it('hydrates persisted measurements back into Cornerstone annotations', async () => {
    const harness = createHarness([
      {
        annotationUID: 'annotation-loaded',
        presetId: 'pa-length',
        label: 'PA length',
        unit: 'mm',
        value: 12.5,
        toothId: 'permanent-1',
        note: null,
        toolName: 'Length',
        points: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        referencedImageId: 'wadors:image-1',
        createdAt: '2026-06-18T00:00:00.000Z',
        updatedAt: '2026-06-18T00:00:00.000Z',
      },
    ]);

    await waitFor(() => {
      expect(harness.commandsManager.runCommand).toHaveBeenCalledWith(
        'hydrateAnnotationForViewport',
        expect.objectContaining({
          viewportId: 'dental-current',
          annotationData: expect.objectContaining({
            annotationUID: 'annotation-loaded',
            metadata: expect.objectContaining({
              referencedImageId: 'wadors:image-1',
              FrameOfReferenceUID: 'frame-from-viewport',
            }),
            data: expect.objectContaining({
              label: 'PA length',
              handles: expect.objectContaining({
                points: [
                  [1, 2, 3],
                  [4, 5, 6],
                ],
              }),
            }),
          }),
        })
      );
    });

    harness.unmount();
    harness.restoreFetch();
  });

  it('captures the complete viewport reference for new measurements', () => {
    const harness = createHarness();

    act(() => harness.result.current.armPreset('pa-length'));
    harness.emit('measurementAdded', {
      measurement: {
        uid: 'annotation-1',
        toolName: 'Length',
        points: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        metadata: {
          referencedImageId: 'wadors:image-1',
        },
        data: { image: { length: 12.5 } },
      },
    });

    expect(harness.cornerstoneViewport.getViewReference).toHaveBeenCalledWith({
      points: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      sliceIndex: 0,
    });
    expect(harness.dentalMeasurementsService.getMeasurements()[0]).toEqual(
      expect.objectContaining({
        referencedImageId: 'wadors:image-1',
        FrameOfReferenceUID: 'frame-from-viewport',
        viewReference: expect.objectContaining({
          referencedImageId: 'wadors:image-1',
          FrameOfReferenceUID: 'frame-from-viewport',
          sliceIndex: 0,
          planeRestriction: expect.objectContaining({
            FrameOfReferenceUID: 'frame-from-viewport',
          }),
        }),
      })
    );

    harness.unmount();
    harness.restoreFetch();
  });

  it('retries hydration when the Cornerstone viewport becomes ready', async () => {
    const harness = createHarness(
      [
        {
          annotationUID: 'annotation-loaded',
          presetId: 'pa-length',
          label: 'PA length',
          unit: 'mm',
          value: 12.5,
          toothId: 'permanent-1',
          note: null,
          toolName: 'Length',
          points: [
            [1, 2, 3],
            [4, 5, 6],
          ],
          referencedImageId: 'wadors:image-1',
          createdAt: '2026-06-18T00:00:00.000Z',
          updatedAt: '2026-06-18T00:00:00.000Z',
        },
      ],
      { viewportAvailable: false }
    );

    await waitFor(() => {
      expect(harness.dentalMeasurementsService.getMeasurements()).toHaveLength(1);
    });
    expect(harness.commandsManager.runCommand).not.toHaveBeenCalledWith(
      'hydrateAnnotationForViewport',
      expect.anything()
    );

    harness.setViewportAvailable(true);
    harness.emitLifecycle('viewportDataChanged');

    await waitFor(() => {
      expect(harness.commandsManager.runCommand).toHaveBeenCalledTimes(1);
    });

    harness.emitLifecycle('viewportDataChanged');
    expect(harness.commandsManager.runCommand).toHaveBeenCalledTimes(1);

    harness.unmount();
    harness.restoreFetch();
  });
});
