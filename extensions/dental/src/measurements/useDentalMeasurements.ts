import { useCallback, useEffect, useMemo, useRef } from 'react';

import { DentalPreferences } from '../preferences/dentalPreferences';
import {
  createDentalMeasurement,
  DentalMeasurement,
  DentalMeasurementViewReference,
  normalizeDentalViewReference,
  updateDentalMeasurement,
} from './dentalMeasurement';
import { DentalMeasurementPresetId, getDentalMeasurementPreset } from './dentalMeasurementPresets';
import { DentalMeasurementsService } from './DentalMeasurementsService';
import { DentalMeasurementsAuthError, createDentalMeasurementsApi } from './dentalMeasurementsApi';

type PendingMeasurement = {
  presetId: DentalMeasurementPresetId;
  toothId: string;
  note: string;
};

type UseDentalMeasurementsOptions = {
  appConfig: AppTypes.Config;
  commandsManager: AppTypes.CommandsManager;
  servicesManager: AppTypes.ServicesManager;
  preferences: DentalPreferences;
};

function getStudyInstanceUID(displaySetService): string | undefined {
  const displaySet = displaySetService.getActiveDisplaySets?.()?.[0];
  const instance = displaySet?.instances?.[0] || displaySet?.instance;

  return displaySet?.StudyInstanceUID || instance?.StudyInstanceUID;
}

function getViewportIdsForMeasurement(
  measurement: DentalMeasurement,
  cornerstoneViewportService,
  viewportGridService
): string[] {
  const ids = [
    measurement.viewportId,
    viewportGridService.getState().activeViewportId,
    ...(cornerstoneViewportService.getViewportIds?.() || []),
  ].filter(Boolean);

  return Array.from(new Set(ids));
}

function resolveViewReference(
  measurement: DentalMeasurement,
  viewport
): DentalMeasurementViewReference | undefined {
  const persistedReference = normalizeDentalViewReference(measurement.viewReference);
  const referencedImageId = persistedReference?.referencedImageId || measurement.referencedImageId;
  const imageIds = viewport.getImageIds?.() || [];
  let sliceIndex = referencedImageId ? imageIds.indexOf(referencedImageId) : -1;

  if (persistedReference) {
    const candidate = {
      ...persistedReference,
      referencedImageId,
    };

    if (viewport.isReferenceViewable?.(candidate, { withNavigation: true })) {
      return candidate;
    }
  }

  if (sliceIndex < 0 && referencedImageId) {
    const imageReference = { referencedImageId };

    if (viewport.isReferenceViewable?.(imageReference, { withNavigation: true })) {
      sliceIndex = viewport.getSliceIndexForImage?.(imageReference) ?? -1;
    }
  }

  if (sliceIndex < 0 || !measurement.points?.length) {
    return undefined;
  }

  return normalizeDentalViewReference(
    viewport.getViewReference?.({
      sliceIndex,
      points: measurement.points,
    })
  );
}

export function useDentalMeasurements({
  appConfig,
  commandsManager,
  servicesManager,
  preferences,
}: UseDentalMeasurementsOptions) {
  const {
    cornerstoneViewportService,
    dentalMeasurementsService,
    displaySetService,
    measurementService,
    viewportGridService,
  } = servicesManager.services as AppTypes.ServicesManager['services'] & {
    dentalMeasurementsService: DentalMeasurementsService;
  };
  const pendingMeasurementRef = useRef<PendingMeasurement | null>(null);
  const studyInstanceUIDRef = useRef<string | undefined>();
  const loadedMeasurementsRef = useRef<DentalMeasurement[]>([]);
  const hydratedMeasurementUIDsRef = useRef(new Set<string>());
  const lockedRef = useRef(false);
  const saveTimersRef = useRef(new Map<string, ReturnType<typeof window.setTimeout>>());
  const dentalConfig = (appConfig as AppTypes.Config & { dental?: Record<string, string> })?.dental;
  const api = useMemo(
    () =>
      createDentalMeasurementsApi({
        baseUrl:
          dentalConfig?.measurementsApiUrl ||
          dentalConfig?.backendUrl ||
          'http://localhost:4007/api/dental',
        authToken:
          dentalConfig?.measurementsAuthToken ||
          dentalConfig?.backendAuthToken ||
          'dev-dental-token',
      }),
    [
      dentalConfig?.backendAuthToken,
      dentalConfig?.backendUrl,
      dentalConfig?.measurementsApiUrl,
      dentalConfig?.measurementsAuthToken,
    ]
  );

  const markApiError = useCallback(
    (error: unknown) => {
      if (error instanceof DentalMeasurementsAuthError) {
        lockedRef.current = true;
        dentalMeasurementsService.setStatus('locked');
        return;
      }

      dentalMeasurementsService.setStatus('unsaved');
    },
    [dentalMeasurementsService]
  );

  const hydrateMeasurements = useCallback(
    (measurements: DentalMeasurement[]) => {
      let hydratedAny = false;
      const navigatedViewportIds = new Set<string>();
      measurements.forEach(measurement => {
        if (
          hydratedMeasurementUIDsRef.current.has(measurement.annotationUID) ||
          measurementService.getMeasurement(measurement.annotationUID) ||
          !measurement.points?.length ||
          !(measurement.viewReference?.referencedImageId || measurement.referencedImageId)
        ) {
          return;
        }

        const target = getViewportIdsForMeasurement(
          measurement,
          cornerstoneViewportService,
          viewportGridService
        )
          .map(viewportId => ({
            viewportId,
            viewport: cornerstoneViewportService.getCornerstoneViewport?.(viewportId),
          }))
          .find(({ viewport }) => viewport && resolveViewReference(measurement, viewport));

        if (!target) {
          return;
        }

        const { viewport, viewportId } = target;
        const viewReference = resolveViewReference(measurement, viewport);
        const frameOfReferenceUID =
          viewReference?.FrameOfReferenceUID || viewport.getFrameOfReferenceUID?.();

        if (!viewReference || !frameOfReferenceUID) {
          return;
        }

        if (
          !navigatedViewportIds.has(viewportId) &&
          !viewport.isReferenceViewable?.(viewReference) &&
          viewport.isReferenceViewable?.(viewReference, { withNavigation: true })
        ) {
          viewport.setViewReference?.(viewReference);
          navigatedViewportIds.add(viewportId);
        }

        const cachedStat =
          measurement.toolName === 'Angle'
            ? { angle: measurement.value }
            : { length: measurement.value, unit: measurement.unit };

        const hydratedUID = commandsManager.runCommand('hydrateAnnotationForViewport', {
          viewportId,
          annotationData: {
            annotationUID: measurement.annotationUID,
            highlighted: false,
            invalidated: true,
            isLocked: false,
            isVisible: true,
            metadata: {
              toolName: measurement.toolName,
              ...viewReference,
              FrameOfReferenceUID: frameOfReferenceUID,
            },
            data: {
              label: measurement.label,
              handles: {
                points: measurement.points,
                activeHandleIndex: null,
                textBox: {
                  hasMoved: false,
                  worldPosition: [0, 0, 0],
                  worldBoundingBox: {
                    topLeft: [0, 0, 0],
                    topRight: [0, 0, 0],
                    bottomLeft: [0, 0, 0],
                    bottomRight: [0, 0, 0],
                  },
                },
              },
              cachedStats: {
                [`imageId:${viewReference.referencedImageId}`]: cachedStat,
              },
            },
          },
        });

        if (!hydratedUID) {
          return;
        }

        hydratedMeasurementUIDsRef.current.add(measurement.annotationUID);
        viewport.render?.();
        hydratedAny = true;
      });

      if (hydratedAny) {
        cornerstoneViewportService.getRenderingEngine?.()?.render?.();
      }

      return true;
    },
    [commandsManager, cornerstoneViewportService, measurementService, viewportGridService]
  );

  const persistMeasurement = useCallback(
    (measurement: DentalMeasurement) => {
      const studyInstanceUID = studyInstanceUIDRef.current;

      if (!studyInstanceUID || lockedRef.current) {
        return;
      }

      const existingTimer = saveTimersRef.current.get(measurement.annotationUID);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      dentalMeasurementsService.setStatus('unsaved');
      const timer = window.setTimeout(() => {
        api
          .upsert(studyInstanceUID, measurement)
          .then(() => dentalMeasurementsService.setStatus('saved'))
          .catch(markApiError);
        saveTimersRef.current.delete(measurement.annotationUID);
      }, 300);
      saveTimersRef.current.set(measurement.annotationUID, timer);
    },
    [api, dentalMeasurementsService, markApiError]
  );

  const armPreset = useCallback(
    (presetId: DentalMeasurementPresetId, note = '') => {
      const preset = getDentalMeasurementPreset(presetId);

      pendingMeasurementRef.current = {
        presetId,
        toothId: preferences.selectedToothId,
        note,
      };
      commandsManager.runCommand('setToolActive', {
        toolName: preset.toolName,
      });
    },
    [commandsManager, preferences.selectedToothId]
  );

  useEffect(() => {
    const loadMeasurements = () => {
      const studyInstanceUID = getStudyInstanceUID(displaySetService);

      if (
        !studyInstanceUID ||
        studyInstanceUID === studyInstanceUIDRef.current ||
        lockedRef.current
      ) {
        return;
      }

      studyInstanceUIDRef.current = studyInstanceUID;
      hydratedMeasurementUIDsRef.current.clear();
      dentalMeasurementsService.setMeasurements([]);
      dentalMeasurementsService.setStatus('loading');
      api
        .load(studyInstanceUID)
        .then(measurements => {
          loadedMeasurementsRef.current = measurements;
          hydrateMeasurements(measurements);
          dentalMeasurementsService.setMeasurements([
            ...measurements,
            ...dentalMeasurementsService.getMeasurements(),
          ]);
          dentalMeasurementsService.setStatus('saved');
        })
        .catch(markApiError);
    };

    loadMeasurements();
    const subscriptions = [
      displaySetService.subscribe?.(displaySetService.EVENTS.DISPLAY_SETS_ADDED, loadMeasurements),
      displaySetService.subscribe?.(
        displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
        loadMeasurements
      ),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.VIEWPORTS_READY, () =>
        hydrateMeasurements(loadedMeasurementsRef.current)
      ),
      cornerstoneViewportService.subscribe?.(
        cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
        () => hydrateMeasurements(loadedMeasurementsRef.current)
      ),
    ].filter(Boolean);

    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [
    api,
    cornerstoneViewportService,
    dentalMeasurementsService,
    displaySetService,
    hydrateMeasurements,
    markApiError,
    viewportGridService,
  ]);

  useEffect(() => {
    const addedSubscription = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_ADDED,
      ({ measurement }) => {
        const pendingMeasurement = pendingMeasurementRef.current;

        if (!pendingMeasurement) {
          return;
        }

        const preset = getDentalMeasurementPreset(pendingMeasurement.presetId);
        if (measurement.toolName !== preset.toolName) {
          return;
        }

        pendingMeasurementRef.current = null;
        const { activeViewportId } = viewportGridService.getState();
        const activeViewport =
          cornerstoneViewportService.getCornerstoneViewport?.(activeViewportId);
        const referencedImageId =
          measurement.referencedImageId || measurement.metadata?.referencedImageId;
        const imageIds = activeViewport?.getImageIds?.() || [];
        const referencedImageIndex = referencedImageId ? imageIds.indexOf(referencedImageId) : -1;
        const viewReference = activeViewport?.getViewReference?.({
          points: measurement.points,
          ...(referencedImageIndex >= 0 ? { sliceIndex: referencedImageIndex } : {}),
        });
        const dentalMeasurement = createDentalMeasurement({
          measurement,
          preset,
          toothId: pendingMeasurement.toothId,
          note: pendingMeasurement.note,
          viewportId: activeViewportId,
          viewReference,
        });

        dentalMeasurementsService.upsertMeasurement(dentalMeasurement);
        persistMeasurement(dentalMeasurement);
        measurementService.update(
          measurement.uid,
          {
            ...measurement,
            label: preset.label,
            unit: preset.unit,
          },
          true
        );
      }
    );

    const updatedSubscription = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      ({ measurement }) => {
        const dentalMeasurement = dentalMeasurementsService
          .getMeasurements()
          .find(candidate => candidate.annotationUID === measurement.uid);

        if (!dentalMeasurement) {
          return;
        }

        const updatedMeasurement = updateDentalMeasurement(dentalMeasurement, measurement);
        dentalMeasurementsService.upsertMeasurement(updatedMeasurement);
        persistMeasurement(updatedMeasurement);
      }
    );
    const removedSubscription = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_REMOVED,
      ({ measurement }) => {
        const annotationUID = measurement?.uid;

        if (!annotationUID) {
          return;
        }

        dentalMeasurementsService.removeMeasurement(annotationUID);
        const studyInstanceUID = studyInstanceUIDRef.current;
        if (studyInstanceUID && !lockedRef.current) {
          api.remove(studyInstanceUID, annotationUID).catch(markApiError);
        }
      }
    );

    return () => {
      addedSubscription.unsubscribe();
      updatedSubscription.unsubscribe();
      removedSubscription.unsubscribe();
    };
  }, [
    api,
    cornerstoneViewportService,
    dentalMeasurementsService,
    markApiError,
    measurementService,
    persistMeasurement,
    viewportGridService,
  ]);

  useEffect(() => {
    dentalMeasurementsService.setDeleteHandler(annotationUID => {
      if (measurementService.getMeasurement(annotationUID)) {
        commandsManager.runCommand('removeMeasurement', { uid: annotationUID });
        return;
      }

      dentalMeasurementsService.removeMeasurement(annotationUID);
      const studyInstanceUID = studyInstanceUIDRef.current;
      if (studyInstanceUID && !lockedRef.current) {
        api.remove(studyInstanceUID, annotationUID).catch(markApiError);
      }
    });

    return () => {
      dentalMeasurementsService.setDeleteHandler(null);
      saveTimersRef.current.forEach(timer => window.clearTimeout(timer));
      saveTimersRef.current.clear();
    };
  }, [api, commandsManager, dentalMeasurementsService, markApiError, measurementService]);

  return { armPreset };
}
