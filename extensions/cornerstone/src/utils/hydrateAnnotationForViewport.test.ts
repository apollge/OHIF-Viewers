jest.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: {
      getAnnotation: jest.fn(),
      addAnnotation: jest.fn(),
      triggerAnnotationCompleted: jest.fn(),
    },
  },
}));

import { annotation } from '@cornerstonejs/tools';
import hydrateAnnotationForViewport from './hydrateAnnotationForViewport';

const mockGetAnnotation = annotation.state.getAnnotation as jest.Mock;
const mockAddAnnotation = annotation.state.addAnnotation as jest.Mock;
const mockTriggerAnnotationCompleted = annotation.state.triggerAnnotationCompleted as jest.Mock;

describe('hydrateAnnotationForViewport', () => {
  beforeEach(() => {
    mockGetAnnotation.mockReset();
    mockAddAnnotation.mockReset();
    mockTriggerAnnotationCompleted.mockReset();
  });

  it('binds a hydrated annotation to the target viewport element and completes it', () => {
    const element = document.createElement('div');
    const viewport = {
      element,
      render: jest.fn(),
    };
    const annotationData = {
      annotationUID: 'annotation-1',
      metadata: {
        toolName: 'Length',
        referencedImageId: 'wadors:image-1',
      },
      data: {
        handles: {
          points: [
            [1, 2, 3],
            [4, 5, 6],
          ],
        },
      },
    };

    const annotationUID = hydrateAnnotationForViewport({
      annotationData,
      viewportId: 'dental-current',
      cornerstoneViewportService: {
        getCornerstoneViewport: jest.fn(() => viewport),
      } as never,
    });

    expect(annotationUID).toBe('annotation-1');
    expect(mockAddAnnotation).toHaveBeenCalledWith(annotationData, element);
    expect(mockTriggerAnnotationCompleted).toHaveBeenCalledWith(annotationData);
    expect(viewport.render).toHaveBeenCalled();
  });

  it('does not duplicate an annotation already in Cornerstone state', () => {
    mockGetAnnotation.mockReturnValue({ annotationUID: 'annotation-1' });

    const annotationUID = hydrateAnnotationForViewport({
      annotationData: { annotationUID: 'annotation-1' },
      viewportId: 'dental-current',
      cornerstoneViewportService: {
        getCornerstoneViewport: jest.fn(),
      } as never,
    });

    expect(annotationUID).toBe('annotation-1');
    expect(mockAddAnnotation).not.toHaveBeenCalled();
  });
});
