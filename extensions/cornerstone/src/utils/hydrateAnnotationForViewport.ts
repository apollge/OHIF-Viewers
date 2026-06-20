import { annotation } from '@cornerstonejs/tools';

type HydrateAnnotationForViewportOptions = {
  annotationData: Record<string, any>;
  viewportId: string;
  cornerstoneViewportService: AppTypes.Services['cornerstoneViewportService'];
};

export default function hydrateAnnotationForViewport({
  annotationData,
  viewportId,
  cornerstoneViewportService,
}: HydrateAnnotationForViewportOptions): string | undefined {
  const annotationUID = annotationData?.annotationUID;

  if (!annotationUID) {
    return undefined;
  }

  if (annotation.state.getAnnotation(annotationUID)) {
    return annotationUID;
  }

  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

  if (!viewport?.element) {
    return undefined;
  }

  annotation.state.addAnnotation(annotationData, viewport.element);
  annotation.state.triggerAnnotationCompleted(annotationData);
  viewport.render();

  return annotationUID;
}
