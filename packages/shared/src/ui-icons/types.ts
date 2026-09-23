export type UiIconTag = 'path' | 'circle' | 'rect' | 'line' | 'polyline' | 'polygon' | 'ellipse';
export type UiIconNode = readonly [tag: UiIconTag, attributes: Readonly<Record<string, string>>];
