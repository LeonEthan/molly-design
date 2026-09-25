import {
  createElement,
  forwardRef,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from 'react';
import {
  volume2Icon,
  volumeXIcon,
  activityIcon,
  alarmClockIcon,
  alignCenterIcon,
  alignJustifyIcon,
  alignLeftIcon,
  alignRightIcon,
  archiveIcon,
  archiveRestoreIcon,
  arrowDownIcon,
  arrowDownAZIcon,
  arrowLeftIcon,
  arrowRightIcon,
  arrowShapeIcon,
  arrowUpIcon,
  arrowUpDownIcon,
  arrowUpRightIcon,
  atSignIcon,
  banIcon,
  bellIcon,
  boldIcon,
  bookOpenIcon,
  botIcon,
  boxesIcon,
  brainIcon,
  brushCleaningIcon,
  bugIcon,
  building2Icon,
  cableIcon,
  calendarClockIcon,
  checkIcon,
  checkCheckIcon,
  chevronDownIcon,
  chevronLeftIcon,
  chevronRightIcon,
  chevronUpIcon,
  chevronsDownUpIcon,
  chevronsUpDownIcon,
  circleIcon,
  circleAlertIcon,
  circleCheckIcon,
  circleDashedIcon,
  circleDotIcon,
  circleMinusIcon,
  circleQuestionMarkIcon,
  circleSlashIcon,
  circleSlash2Icon,
  circleStopIcon,
  circleXIcon,
  clipboardListIcon,
  clipboardPasteIcon,
  clockIcon,
  clock3Icon,
  cloudIcon,
  cloudOffIcon,
  codeIcon,
  columns2Icon,
  commandIcon,
  compassIcon,
  copyIcon,
  cornerLeftUpIcon,
  cpuIcon,
  cropIcon,
  downloadIcon,
  earthIcon,
  ellipseIcon,
  ellipsisIcon,
  externalLinkIcon,
  eyeIcon,
  eyeClosedIcon,
  eyeOffIcon,
  fileIcon,
  fileArchiveIcon,
  fileAudioIcon,
  fileCodeIcon,
  fileCode2Icon,
  fileDiffIcon,
  fileImageIcon,
  fileJsonIcon,
  fileSpreadsheetIcon,
  fileTextIcon,
  fileVideoIcon,
  fileWarningIcon,
  filesIcon,
  flaskConicalIcon,
  folderIcon,
  folderGit2Icon,
  folderOpenIcon,
  folderPlusIcon,
  folderTreeIcon,
  funnelIcon,
  gaugeIcon,
  gitBranchIcon,
  gitBranchPlusIcon,
  gitForkIcon,
  gitMergeIcon,
  gitPullRequestIcon,
  gitPullRequestArrowIcon,
  gitPullRequestClosedIcon,
  gitPullRequestDraftIcon,
  globeIcon,
  gripHorizontalIcon,
  gripVerticalIcon,
  handIcon,
  hardDriveIcon,
  highlighterIcon,
  historyIcon,
  houseIcon,
  imageIcon,
  imageOffIcon,
  imagePlusIcon,
  infoIcon,
  italicIcon,
  keyRoundIcon,
  keyboardIcon,
  laptopIcon,
  layersIcon,
  layoutGridIcon,
  lineIcon,
  linkIcon,
  link2Icon,
  listIcon,
  listChecksIcon,
  listFilterIcon,
  listTodoIcon,
  loaderIcon,
  loaderCircleIcon,
  lockIcon,
  lockKeyholeIcon,
  logInIcon,
  logOutIcon,
  mailIcon,
  maximizeIcon,
  maximize2Icon,
  messageCircleIcon,
  messageSquareIcon,
  messageSquareMoreIcon,
  messageSquareOffIcon,
  messageSquarePlusIcon,
  messagesSquareIcon,
  minimize2Icon,
  minusIcon,
  monitorIcon,
  monitorPlayIcon,
  monitorSmartphoneIcon,
  moonIcon,
  mousePointer2Icon,
  moveRightIcon,
  packageOpenIcon,
  paletteIcon,
  panelBottomIcon,
  panelLeftIcon,
  panelRightIcon,
  paperclipIcon,
  pauseIcon,
  penLineIcon,
  pencilIcon,
  pencilLineIcon,
  pinIcon,
  pinOffIcon,
  playIcon,
  plugIcon,
  plusIcon,
  priorityHighIcon,
  priorityLowIcon,
  priorityMediumIcon,
  priorityNoneIcon,
  priorityUrgentIcon,
  progressIcon,
  quoteIcon,
  rectangleIcon,
  redo2Icon,
  referenceIcon,
  refreshCcwIcon,
  refreshCwIcon,
  regenerateIcon,
  removeFormattingIcon,
  repeatIcon,
  rotateCcwIcon,
  rows3Icon,
  saveIcon,
  scrollTextIcon,
  searchIcon,
  searchXIcon,
  sendIcon,
  sendHorizontalIcon,
  settingsIcon,
  settings2Icon,
  shieldAlertIcon,
  shieldCheckIcon,
  shieldOffIcon,
  slidersHorizontalIcon,
  slidersVerticalIcon,
  sparklesIcon,
  squareIcon,
  squareCheckIcon,
  squareChevronRightIcon,
  squarePenIcon,
  squareTerminalIcon,
  stopIcon,
  strikethroughIcon,
  sunIcon,
  table2Icon,
  tagIcon,
  targetIcon,
  terminalIcon,
  timerResetIcon,
  trash2Icon,
  triangleIcon,
  triangleAlertIcon,
  typeIcon,
  undo2Icon,
  unlinkIcon,
  uploadIcon,
  userIcon,
  userRoundIcon,
  userRoundCogIcon,
  usersIcon,
  wifiOffIcon,
  workflowIcon,
  worktreeIcon,
  wrapTextIcon,
  wrenchIcon,
  xIcon,
  zapIcon,
  zapOffIcon,
  zoomInIcon,
  zoomOutIcon,
  type UiIconNode,
} from '@molly/shared/ui-icons';

/** Compatible with the props accepted by the former Lucide components. */
export interface LucideProps extends Partial<SVGProps<SVGSVGElement>> {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}
export type LucideIcon = ForwardRefExoticComponent<
  Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>
>;

function reactSvgAttributes(attributes: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => [
      name.startsWith('aria-') || name.startsWith('data-')
        ? name
        : name === 'class'
          ? 'className'
          : name.replace(/[-:]([a-z])/gu, (_, character: string) => character.toUpperCase()),
      value,
    ])
  );
}

/** Adapts the canonical SVG nodes once; imports and aliases share component identity. */
export function createUiIcon(
  name: string,
  nodes: readonly UiIconNode[],
  { brand = false }: { brand?: boolean } = {}
): LucideIcon {
  const shapes = nodes.map(([tag, attributes], key) =>
    createElement(tag, { ...reactSvgAttributes(attributes), key })
  );
  const glyphClass = 'lucide-' + name.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase();
  const Component = forwardRef<SVGSVGElement, LucideProps>(function UiIcon(
    {
      size = 24,
      color = 'currentColor',
      strokeWidth = 1.5,
      absoluteStrokeWidth = false,
      className,
      style,
      children,
      ...props
    },
    ref
  ) {
    const numericSize = Number(size);
    const adjustedStrokeWidth =
      absoluteStrokeWidth && Number.isFinite(numericSize) && numericSize > 0
        ? (Number(strokeWidth) * 24) / numericSize
        : strokeWidth;
    const hasAccessibleName =
      children != null ||
      Object.keys(props).some(
        (key) => key.startsWith('aria-') || key === 'role' || key === 'title'
      );
    return createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: adjustedStrokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: ['lucide', glyphClass, brand ? 'molly-brand-icon' : 'molly-icon', className]
          .filter(Boolean)
          .join(' '),
        ...(brand ? { 'data-molly-brand': name } : { 'data-molly-icon': name }),
        ...(!hasAccessibleName ? { 'aria-hidden': true } : {}),
        // Legacy per-call weights remain normalized by the UI stylesheet. An
        // explicit absoluteStrokeWidth request instead owns its rendered weight;
        // inline style keeps that opt-in effective under the normalization rule.
        style: absoluteStrokeWidth ? { strokeWidth: adjustedStrokeWidth, ...style } : style,
        ...props,
        ref,
      },
      ...shapes,
      children
    );
  });
  Component.displayName = name;
  return Component;
}

export const Activity = /* @__PURE__ */ createUiIcon('Activity', activityIcon);
export const AlarmClock = /* @__PURE__ */ createUiIcon('AlarmClock', alarmClockIcon);
export const AlignCenter = /* @__PURE__ */ createUiIcon('AlignCenter', alignCenterIcon);
export const AlignJustify = /* @__PURE__ */ createUiIcon('AlignJustify', alignJustifyIcon);
export const AlignLeft = /* @__PURE__ */ createUiIcon('AlignLeft', alignLeftIcon);
export const AlignRight = /* @__PURE__ */ createUiIcon('AlignRight', alignRightIcon);
export const Archive = /* @__PURE__ */ createUiIcon('Archive', archiveIcon);
export const ArchiveRestore = /* @__PURE__ */ createUiIcon('ArchiveRestore', archiveRestoreIcon);
export const ArrowDown = /* @__PURE__ */ createUiIcon('ArrowDown', arrowDownIcon);
export const ArrowDownAZ = /* @__PURE__ */ createUiIcon('ArrowDownAZ', arrowDownAZIcon);
export const ArrowLeft = /* @__PURE__ */ createUiIcon('ArrowLeft', arrowLeftIcon);
export const ArrowRight = /* @__PURE__ */ createUiIcon('ArrowRight', arrowRightIcon);
export const ArrowShape = /* @__PURE__ */ createUiIcon('ArrowShape', arrowShapeIcon);
export const ArrowUp = /* @__PURE__ */ createUiIcon('ArrowUp', arrowUpIcon);
export const ArrowUpDown = /* @__PURE__ */ createUiIcon('ArrowUpDown', arrowUpDownIcon);
export const ArrowUpRight = /* @__PURE__ */ createUiIcon('ArrowUpRight', arrowUpRightIcon);
export const AtSign = /* @__PURE__ */ createUiIcon('AtSign', atSignIcon);
export const Ban = /* @__PURE__ */ createUiIcon('Ban', banIcon);
export const Bell = /* @__PURE__ */ createUiIcon('Bell', bellIcon);
export const Bold = /* @__PURE__ */ createUiIcon('Bold', boldIcon);
export const BookOpen = /* @__PURE__ */ createUiIcon('BookOpen', bookOpenIcon);
export const Bot = /* @__PURE__ */ createUiIcon('Bot', botIcon);
export const Boxes = /* @__PURE__ */ createUiIcon('Boxes', boxesIcon);
export const Brain = /* @__PURE__ */ createUiIcon('Brain', brainIcon);
export const BrushCleaning = /* @__PURE__ */ createUiIcon('BrushCleaning', brushCleaningIcon);
export const Bug = /* @__PURE__ */ createUiIcon('Bug', bugIcon);
export const Building2 = /* @__PURE__ */ createUiIcon('Building2', building2Icon);
export const Cable = /* @__PURE__ */ createUiIcon('Cable', cableIcon);
export const CalendarClock = /* @__PURE__ */ createUiIcon('CalendarClock', calendarClockIcon);
export const Check = /* @__PURE__ */ createUiIcon('Check', checkIcon);
export const CheckCheck = /* @__PURE__ */ createUiIcon('CheckCheck', checkCheckIcon);
export const ChevronDown = /* @__PURE__ */ createUiIcon('ChevronDown', chevronDownIcon);
export const ChevronLeft = /* @__PURE__ */ createUiIcon('ChevronLeft', chevronLeftIcon);
export const ChevronRight = /* @__PURE__ */ createUiIcon('ChevronRight', chevronRightIcon);
export const ChevronUp = /* @__PURE__ */ createUiIcon('ChevronUp', chevronUpIcon);
export const ChevronsDownUp = /* @__PURE__ */ createUiIcon('ChevronsDownUp', chevronsDownUpIcon);
export const ChevronsUpDown = /* @__PURE__ */ createUiIcon('ChevronsUpDown', chevronsUpDownIcon);
export const Circle = /* @__PURE__ */ createUiIcon('Circle', circleIcon);
export const CircleAlert = /* @__PURE__ */ createUiIcon('CircleAlert', circleAlertIcon);
export const CircleCheck = /* @__PURE__ */ createUiIcon('CircleCheck', circleCheckIcon);
export const CircleDashed = /* @__PURE__ */ createUiIcon('CircleDashed', circleDashedIcon);
export const CircleDot = /* @__PURE__ */ createUiIcon('CircleDot', circleDotIcon);
export const CircleMinus = /* @__PURE__ */ createUiIcon('CircleMinus', circleMinusIcon);
export const CircleQuestionMark = /* @__PURE__ */ createUiIcon(
  'CircleQuestionMark',
  circleQuestionMarkIcon
);
export const CircleSlash = /* @__PURE__ */ createUiIcon('CircleSlash', circleSlashIcon);
export const CircleSlash2 = /* @__PURE__ */ createUiIcon('CircleSlash2', circleSlash2Icon);
export const CircleStop = /* @__PURE__ */ createUiIcon('CircleStop', circleStopIcon);
export const CircleX = /* @__PURE__ */ createUiIcon('CircleX', circleXIcon);
export const ClipboardList = /* @__PURE__ */ createUiIcon('ClipboardList', clipboardListIcon);
export const ClipboardPaste = /* @__PURE__ */ createUiIcon('ClipboardPaste', clipboardPasteIcon);
export const Clock = /* @__PURE__ */ createUiIcon('Clock', clockIcon);
export const Clock3 = /* @__PURE__ */ createUiIcon('Clock3', clock3Icon);
export const Cloud = /* @__PURE__ */ createUiIcon('Cloud', cloudIcon);
export const CloudOff = /* @__PURE__ */ createUiIcon('CloudOff', cloudOffIcon);
export const Code = /* @__PURE__ */ createUiIcon('Code', codeIcon);
export const Columns2 = /* @__PURE__ */ createUiIcon('Columns2', columns2Icon);
export const Command = /* @__PURE__ */ createUiIcon('Command', commandIcon);
export const Compass = /* @__PURE__ */ createUiIcon('Compass', compassIcon);
export const Copy = /* @__PURE__ */ createUiIcon('Copy', copyIcon);
export const CornerLeftUp = /* @__PURE__ */ createUiIcon('CornerLeftUp', cornerLeftUpIcon);
export const Cpu = /* @__PURE__ */ createUiIcon('Cpu', cpuIcon);
export const Crop = /* @__PURE__ */ createUiIcon('Crop', cropIcon);
export const Download = /* @__PURE__ */ createUiIcon('Download', downloadIcon);
export const Earth = /* @__PURE__ */ createUiIcon('Earth', earthIcon);
export const Ellipse = /* @__PURE__ */ createUiIcon('Ellipse', ellipseIcon);
export const Ellipsis = /* @__PURE__ */ createUiIcon('Ellipsis', ellipsisIcon);
export const ExternalLink = /* @__PURE__ */ createUiIcon('ExternalLink', externalLinkIcon);
export const Eye = /* @__PURE__ */ createUiIcon('Eye', eyeIcon);
export const EyeClosed = /* @__PURE__ */ createUiIcon('EyeClosed', eyeClosedIcon);
export const EyeOff = /* @__PURE__ */ createUiIcon('EyeOff', eyeOffIcon);
export const File = /* @__PURE__ */ createUiIcon('File', fileIcon);
export const FileArchive = /* @__PURE__ */ createUiIcon('FileArchive', fileArchiveIcon);
export const FileAudio = /* @__PURE__ */ createUiIcon('FileAudio', fileAudioIcon);
export const FileCode = /* @__PURE__ */ createUiIcon('FileCode', fileCodeIcon);
export const FileCode2 = /* @__PURE__ */ createUiIcon('FileCode2', fileCode2Icon);
export const FileDiff = /* @__PURE__ */ createUiIcon('FileDiff', fileDiffIcon);
export const FileImage = /* @__PURE__ */ createUiIcon('FileImage', fileImageIcon);
export const FileJson = /* @__PURE__ */ createUiIcon('FileJson', fileJsonIcon);
export const FileSpreadsheet = /* @__PURE__ */ createUiIcon('FileSpreadsheet', fileSpreadsheetIcon);
export const FileText = /* @__PURE__ */ createUiIcon('FileText', fileTextIcon);
export const FileVideo = /* @__PURE__ */ createUiIcon('FileVideo', fileVideoIcon);
export const FileWarning = /* @__PURE__ */ createUiIcon('FileWarning', fileWarningIcon);
export const Files = /* @__PURE__ */ createUiIcon('Files', filesIcon);
export const FlaskConical = /* @__PURE__ */ createUiIcon('FlaskConical', flaskConicalIcon);
export const Folder = /* @__PURE__ */ createUiIcon('Folder', folderIcon);
export const FolderGit2 = /* @__PURE__ */ createUiIcon('FolderGit2', folderGit2Icon);
export const FolderOpen = /* @__PURE__ */ createUiIcon('FolderOpen', folderOpenIcon);
export const FolderPlus = /* @__PURE__ */ createUiIcon('FolderPlus', folderPlusIcon);
export const FolderTree = /* @__PURE__ */ createUiIcon('FolderTree', folderTreeIcon);
export const Funnel = /* @__PURE__ */ createUiIcon('Funnel', funnelIcon);
export const Gauge = /* @__PURE__ */ createUiIcon('Gauge', gaugeIcon);
export const GitBranch = /* @__PURE__ */ createUiIcon('GitBranch', gitBranchIcon);
export const GitBranchPlus = /* @__PURE__ */ createUiIcon('GitBranchPlus', gitBranchPlusIcon);
export const GitFork = /* @__PURE__ */ createUiIcon('GitFork', gitForkIcon);
export const GitMerge = /* @__PURE__ */ createUiIcon('GitMerge', gitMergeIcon);
export const GitPullRequest = /* @__PURE__ */ createUiIcon('GitPullRequest', gitPullRequestIcon);
export const GitPullRequestArrow = /* @__PURE__ */ createUiIcon(
  'GitPullRequestArrow',
  gitPullRequestArrowIcon
);
export const GitPullRequestClosed = /* @__PURE__ */ createUiIcon(
  'GitPullRequestClosed',
  gitPullRequestClosedIcon
);
export const GitPullRequestDraft = /* @__PURE__ */ createUiIcon(
  'GitPullRequestDraft',
  gitPullRequestDraftIcon
);
export const Globe = /* @__PURE__ */ createUiIcon('Globe', globeIcon);
export const GripHorizontal = /* @__PURE__ */ createUiIcon('GripHorizontal', gripHorizontalIcon);
export const GripVertical = /* @__PURE__ */ createUiIcon('GripVertical', gripVerticalIcon);
export const Hand = /* @__PURE__ */ createUiIcon('Hand', handIcon);
export const HardDrive = /* @__PURE__ */ createUiIcon('HardDrive', hardDriveIcon);
export const Highlighter = /* @__PURE__ */ createUiIcon('Highlighter', highlighterIcon);
export const History = /* @__PURE__ */ createUiIcon('History', historyIcon);
export const House = /* @__PURE__ */ createUiIcon('House', houseIcon);
export const Image = /* @__PURE__ */ createUiIcon('Image', imageIcon);
export const ImageOff = /* @__PURE__ */ createUiIcon('ImageOff', imageOffIcon);
export const ImagePlus = /* @__PURE__ */ createUiIcon('ImagePlus', imagePlusIcon);
export const Info = /* @__PURE__ */ createUiIcon('Info', infoIcon);
export const Italic = /* @__PURE__ */ createUiIcon('Italic', italicIcon);
export const KeyRound = /* @__PURE__ */ createUiIcon('KeyRound', keyRoundIcon);
export const Keyboard = /* @__PURE__ */ createUiIcon('Keyboard', keyboardIcon);
export const Laptop = /* @__PURE__ */ createUiIcon('Laptop', laptopIcon);
export const Layers = /* @__PURE__ */ createUiIcon('Layers', layersIcon);
export const LayoutGrid = /* @__PURE__ */ createUiIcon('LayoutGrid', layoutGridIcon);
export const Line = /* @__PURE__ */ createUiIcon('Line', lineIcon);
export const Link = /* @__PURE__ */ createUiIcon('Link', linkIcon);
export const Link2 = /* @__PURE__ */ createUiIcon('Link2', link2Icon);
export const List = /* @__PURE__ */ createUiIcon('List', listIcon);
export const ListChecks = /* @__PURE__ */ createUiIcon('ListChecks', listChecksIcon);
export const ListFilter = /* @__PURE__ */ createUiIcon('ListFilter', listFilterIcon);
export const ListTodo = /* @__PURE__ */ createUiIcon('ListTodo', listTodoIcon);
export const Loader = /* @__PURE__ */ createUiIcon('Loader', loaderIcon);
export const LoaderCircle = /* @__PURE__ */ createUiIcon('LoaderCircle', loaderCircleIcon);
export const Lock = /* @__PURE__ */ createUiIcon('Lock', lockIcon);
export const LockKeyhole = /* @__PURE__ */ createUiIcon('LockKeyhole', lockKeyholeIcon);
export const LogIn = /* @__PURE__ */ createUiIcon('LogIn', logInIcon);
export const LogOut = /* @__PURE__ */ createUiIcon('LogOut', logOutIcon);
export const Mail = /* @__PURE__ */ createUiIcon('Mail', mailIcon);
export const Maximize = /* @__PURE__ */ createUiIcon('Maximize', maximizeIcon);
export const Maximize2 = /* @__PURE__ */ createUiIcon('Maximize2', maximize2Icon);
export const MessageCircle = /* @__PURE__ */ createUiIcon('MessageCircle', messageCircleIcon);
export const MessageSquare = /* @__PURE__ */ createUiIcon('MessageSquare', messageSquareIcon);
export const MessageSquareMore = /* @__PURE__ */ createUiIcon(
  'MessageSquareMore',
  messageSquareMoreIcon
);
export const MessageSquareOff = /* @__PURE__ */ createUiIcon(
  'MessageSquareOff',
  messageSquareOffIcon
);
export const MessageSquarePlus = /* @__PURE__ */ createUiIcon(
  'MessageSquarePlus',
  messageSquarePlusIcon
);
export const MessagesSquare = /* @__PURE__ */ createUiIcon('MessagesSquare', messagesSquareIcon);
export const Minimize2 = /* @__PURE__ */ createUiIcon('Minimize2', minimize2Icon);
export const Minus = /* @__PURE__ */ createUiIcon('Minus', minusIcon);
export const Monitor = /* @__PURE__ */ createUiIcon('Monitor', monitorIcon);
export const MonitorPlay = /* @__PURE__ */ createUiIcon('MonitorPlay', monitorPlayIcon);
export const MonitorSmartphone = /* @__PURE__ */ createUiIcon(
  'MonitorSmartphone',
  monitorSmartphoneIcon
);
export const Moon = /* @__PURE__ */ createUiIcon('Moon', moonIcon);
export const MousePointer2 = /* @__PURE__ */ createUiIcon('MousePointer2', mousePointer2Icon);
export const MoveRight = /* @__PURE__ */ createUiIcon('MoveRight', moveRightIcon);
export const PackageOpen = /* @__PURE__ */ createUiIcon('PackageOpen', packageOpenIcon);
export const Palette = /* @__PURE__ */ createUiIcon('Palette', paletteIcon);
export const PanelBottom = /* @__PURE__ */ createUiIcon('PanelBottom', panelBottomIcon);
export const PanelLeft = /* @__PURE__ */ createUiIcon('PanelLeft', panelLeftIcon);
export const PanelRight = /* @__PURE__ */ createUiIcon('PanelRight', panelRightIcon);
export const Paperclip = /* @__PURE__ */ createUiIcon('Paperclip', paperclipIcon);
export const Pause = /* @__PURE__ */ createUiIcon('Pause', pauseIcon);
export const PenLine = /* @__PURE__ */ createUiIcon('PenLine', penLineIcon);
export const Pencil = /* @__PURE__ */ createUiIcon('Pencil', pencilIcon);
export const PencilLine = /* @__PURE__ */ createUiIcon('PencilLine', pencilLineIcon);
export const Pin = /* @__PURE__ */ createUiIcon('Pin', pinIcon);
export const PinOff = /* @__PURE__ */ createUiIcon('PinOff', pinOffIcon);
export const Play = /* @__PURE__ */ createUiIcon('Play', playIcon);
export const Plug = /* @__PURE__ */ createUiIcon('Plug', plugIcon);
export const Plus = /* @__PURE__ */ createUiIcon('Plus', plusIcon);
export const PriorityHigh = /* @__PURE__ */ createUiIcon('PriorityHigh', priorityHighIcon);
export const PriorityLow = /* @__PURE__ */ createUiIcon('PriorityLow', priorityLowIcon);
export const PriorityMedium = /* @__PURE__ */ createUiIcon('PriorityMedium', priorityMediumIcon);
export const PriorityNone = /* @__PURE__ */ createUiIcon('PriorityNone', priorityNoneIcon);
export const PriorityUrgent = /* @__PURE__ */ createUiIcon('PriorityUrgent', priorityUrgentIcon);
export const Progress = /* @__PURE__ */ createUiIcon('Progress', progressIcon);
export const Quote = /* @__PURE__ */ createUiIcon('Quote', quoteIcon);
export const Rectangle = /* @__PURE__ */ createUiIcon('Rectangle', rectangleIcon);
export const Redo2 = /* @__PURE__ */ createUiIcon('Redo2', redo2Icon);
export const Reference = /* @__PURE__ */ createUiIcon('Reference', referenceIcon);
export const RefreshCcw = /* @__PURE__ */ createUiIcon('RefreshCcw', refreshCcwIcon);
export const RefreshCw = /* @__PURE__ */ createUiIcon('RefreshCw', refreshCwIcon);
export const Regenerate = /* @__PURE__ */ createUiIcon('Regenerate', regenerateIcon);
export const RemoveFormatting = /* @__PURE__ */ createUiIcon(
  'RemoveFormatting',
  removeFormattingIcon
);
export const Repeat = /* @__PURE__ */ createUiIcon('Repeat', repeatIcon);
export const RotateCcw = /* @__PURE__ */ createUiIcon('RotateCcw', rotateCcwIcon);
export const Rows3 = /* @__PURE__ */ createUiIcon('Rows3', rows3Icon);
export const Save = /* @__PURE__ */ createUiIcon('Save', saveIcon);
export const ScrollText = /* @__PURE__ */ createUiIcon('ScrollText', scrollTextIcon);
export const Search = /* @__PURE__ */ createUiIcon('Search', searchIcon);
export const SearchX = /* @__PURE__ */ createUiIcon('SearchX', searchXIcon);
export const Send = /* @__PURE__ */ createUiIcon('Send', sendIcon);
export const SendHorizontal = /* @__PURE__ */ createUiIcon('SendHorizontal', sendHorizontalIcon);
export const Settings = /* @__PURE__ */ createUiIcon('Settings', settingsIcon);
export const Settings2 = /* @__PURE__ */ createUiIcon('Settings2', settings2Icon);
export const ShieldAlert = /* @__PURE__ */ createUiIcon('ShieldAlert', shieldAlertIcon);
export const ShieldCheck = /* @__PURE__ */ createUiIcon('ShieldCheck', shieldCheckIcon);
export const ShieldOff = /* @__PURE__ */ createUiIcon('ShieldOff', shieldOffIcon);
export const SlidersHorizontal = /* @__PURE__ */ createUiIcon(
  'SlidersHorizontal',
  slidersHorizontalIcon
);
export const SlidersVertical = /* @__PURE__ */ createUiIcon('SlidersVertical', slidersVerticalIcon);
export const Sparkles = /* @__PURE__ */ createUiIcon('Sparkles', sparklesIcon);
export const Square = /* @__PURE__ */ createUiIcon('Square', squareIcon);
export const SquareCheck = /* @__PURE__ */ createUiIcon('SquareCheck', squareCheckIcon);
export const SquareChevronRight = /* @__PURE__ */ createUiIcon(
  'SquareChevronRight',
  squareChevronRightIcon
);
export const SquarePen = /* @__PURE__ */ createUiIcon('SquarePen', squarePenIcon);
export const SquareTerminal = /* @__PURE__ */ createUiIcon('SquareTerminal', squareTerminalIcon);
export const Stop = /* @__PURE__ */ createUiIcon('Stop', stopIcon);
export const Strikethrough = /* @__PURE__ */ createUiIcon('Strikethrough', strikethroughIcon);
export const Sun = /* @__PURE__ */ createUiIcon('Sun', sunIcon);
export const Table2 = /* @__PURE__ */ createUiIcon('Table2', table2Icon);
export const Tag = /* @__PURE__ */ createUiIcon('Tag', tagIcon);
export const Target = /* @__PURE__ */ createUiIcon('Target', targetIcon);
export const Terminal = /* @__PURE__ */ createUiIcon('Terminal', terminalIcon);
export const TimerReset = /* @__PURE__ */ createUiIcon('TimerReset', timerResetIcon);
export const Trash2 = /* @__PURE__ */ createUiIcon('Trash2', trash2Icon);
export const Triangle = /* @__PURE__ */ createUiIcon('Triangle', triangleIcon);
export const TriangleAlert = /* @__PURE__ */ createUiIcon('TriangleAlert', triangleAlertIcon);
export const Type = /* @__PURE__ */ createUiIcon('Type', typeIcon);
export const Undo2 = /* @__PURE__ */ createUiIcon('Undo2', undo2Icon);
export const Unlink = /* @__PURE__ */ createUiIcon('Unlink', unlinkIcon);
export const Upload = /* @__PURE__ */ createUiIcon('Upload', uploadIcon);
export const User = /* @__PURE__ */ createUiIcon('User', userIcon);
export const UserRound = /* @__PURE__ */ createUiIcon('UserRound', userRoundIcon);
export const UserRoundCog = /* @__PURE__ */ createUiIcon('UserRoundCog', userRoundCogIcon);
export const Users = /* @__PURE__ */ createUiIcon('Users', usersIcon);
export const WifiOff = /* @__PURE__ */ createUiIcon('WifiOff', wifiOffIcon);
export const Workflow = /* @__PURE__ */ createUiIcon('Workflow', workflowIcon);
export const Worktree = /* @__PURE__ */ createUiIcon('Worktree', worktreeIcon);
export const WrapText = /* @__PURE__ */ createUiIcon('WrapText', wrapTextIcon);
export const Wrench = /* @__PURE__ */ createUiIcon('Wrench', wrenchIcon);
export const X = /* @__PURE__ */ createUiIcon('X', xIcon);
export const Zap = /* @__PURE__ */ createUiIcon('Zap', zapIcon);
export const ZapOff = /* @__PURE__ */ createUiIcon('ZapOff', zapOffIcon);
export const ZoomIn = /* @__PURE__ */ createUiIcon('ZoomIn', zoomInIcon);
export const ZoomOut = /* @__PURE__ */ createUiIcon('ZoomOut', zoomOutIcon);

/* Github brand geometry retained from Lucide 0.525.0, ISC License.
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 * part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2022.
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
export const Github = /* @__PURE__ */ createUiIcon(
  'Github',
  [
    [
      'path',
      {
        d: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
      },
    ],
    ['path', { d: 'M9 18c-4.51 2-5-2-7-2' }],
  ],
  { brand: true }
);

// Existing application and third-party names remain aliases of one component.
export {
  Activity as ActivityIcon,
  AlarmClock as AlarmClockIcon,
  CircleAlert as AlertCircle,
  TriangleAlert as AlertTriangle,
  AlignCenter as AlignCenterIcon,
  AlignJustify as AlignJustifyIcon,
  AlignLeft as AlignLeftIcon,
  AlignRight as AlignRightIcon,
  Archive as ArchiveIcon,
  ArchiveRestore as ArchiveRestoreIcon,
  ArrowDownAZ as ArrowDownAZIcon,
  ArrowDown as ArrowDownIcon,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ArrowShape as ArrowShapeIcon,
  ArrowUpDown as ArrowUpDownIcon,
  ArrowUp as ArrowUpIcon,
  ArrowUpRight as ArrowUpRightIcon,
  AtSign as AtSignIcon,
  Ban as BanIcon,
  Bell as BellIcon,
  Bold as BoldIcon,
  BookOpen as BookOpenIcon,
  Bot as BotIcon,
  Boxes as BoxesIcon,
  Brain as BrainIcon,
  BrushCleaning as BrushCleaningIcon,
  Bug as BugIcon,
  Building2 as Building2Icon,
  Cable as CableIcon,
  CalendarClock as CalendarClockIcon,
  CheckCheck as CheckCheckIcon,
  CircleCheck as CheckCircle2,
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsDownUp as ChevronsDownUpIcon,
  ChevronsUpDown as ChevronsUpDownIcon,
  ChevronUp as ChevronUpIcon,
  CircleAlert as CircleAlertIcon,
  CircleCheck as CircleCheckIcon,
  CircleDashed as CircleDashedIcon,
  CircleDot as CircleDotIcon,
  CircleQuestionMark as CircleHelp,
  Circle as CircleIcon,
  CircleMinus as CircleMinusIcon,
  CircleQuestionMark as CircleQuestionMarkIcon,
  CircleSlash2 as CircleSlash2Icon,
  CircleSlash as CircleSlashIcon,
  CircleStop as CircleStopIcon,
  CircleX as CircleXIcon,
  ClipboardList as ClipboardListIcon,
  ClipboardPaste as ClipboardPasteIcon,
  Clock3 as Clock3Icon,
  Clock as ClockIcon,
  Cloud as CloudIcon,
  CloudOff as CloudOffIcon,
  Code as CodeIcon,
  Columns2 as Columns2Icon,
  Command as CommandIcon,
  Compass as CompassIcon,
  Copy as CopyIcon,
  CornerLeftUp as CornerLeftUpIcon,
  Cpu as CpuIcon,
  Crop as CropIcon,
  Download as DownloadIcon,
  Earth as EarthIcon,
  Ellipse as EllipseIcon,
  Ellipsis as EllipsisIcon,
  ExternalLink as ExternalLinkIcon,
  EyeClosed as EyeClosedIcon,
  Eye as EyeIcon,
  EyeOff as EyeOffIcon,
  FileArchive as FileArchiveIcon,
  FileAudio as FileAudioIcon,
  FileCode2 as FileCode2Icon,
  FileCode as FileCodeIcon,
  FileDiff as FileDiffIcon,
  File as FileIcon,
  FileImage as FileImageIcon,
  FileJson as FileJsonIcon,
  Files as FilesIcon,
  FileSpreadsheet as FileSpreadsheetIcon,
  FileText as FileTextIcon,
  FileVideo as FileVideoIcon,
  FileWarning as FileWarningIcon,
  Funnel as Filter,
  FlaskConical as FlaskConicalIcon,
  FolderGit2 as FolderGit2Icon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  FolderPlus as FolderPlusIcon,
  FolderTree as FolderTreeIcon,
  Funnel as FunnelIcon,
  Gauge as GaugeIcon,
  GitBranch as GitBranchIcon,
  GitBranchPlus as GitBranchPlusIcon,
  GitFork as GitForkIcon,
  Github as GithubIcon,
  GitMerge as GitMergeIcon,
  GitPullRequestArrow as GitPullRequestArrowIcon,
  GitPullRequestClosed as GitPullRequestClosedIcon,
  GitPullRequestDraft as GitPullRequestDraftIcon,
  GitPullRequest as GitPullRequestIcon,
  Earth as Globe2,
  Globe as GlobeIcon,
  GripHorizontal as GripHorizontalIcon,
  GripVertical as GripVerticalIcon,
  Hand as HandIcon,
  HardDrive as HardDriveIcon,
  CircleQuestionMark as HelpCircle,
  Highlighter as HighlighterIcon,
  History as HistoryIcon,
  House as Home,
  House as HouseIcon,
  Image as ImageIcon,
  ImageOff as ImageOffIcon,
  ImagePlus as ImagePlusIcon,
  Info as InfoIcon,
  Italic as ItalicIcon,
  Keyboard as KeyboardIcon,
  KeyRound as KeyRoundIcon,
  Laptop as LaptopIcon,
  Layers as LayersIcon,
  LayoutGrid as LayoutGridIcon,
  Line as LineIcon,
  Link2 as Link2Icon,
  Link as LinkIcon,
  ListChecks as ListChecksIcon,
  ListFilter as ListFilterIcon,
  List as ListIcon,
  ListTodo as ListTodoIcon,
  LoaderCircle as Loader2,
  LoaderCircle as LoaderCircleIcon,
  Loader as LoaderIcon,
  Lock as LockIcon,
  LockKeyhole as LockKeyholeIcon,
  LogIn as LogInIcon,
  LogOut as LogOutIcon,
  Mail as MailIcon,
  Maximize2 as Maximize2Icon,
  Maximize as MaximizeIcon,
  MessageCircle as MessageCircleIcon,
  MessageSquare as MessageSquareIcon,
  MessageSquareMore as MessageSquareMoreIcon,
  MessageSquareOff as MessageSquareOffIcon,
  MessageSquarePlus as MessageSquarePlusIcon,
  MessagesSquare as MessagesSquareIcon,
  Minimize2 as Minimize2Icon,
  CircleMinus as MinusCircle,
  Minus as MinusIcon,
  Monitor as MonitorIcon,
  MonitorPlay as MonitorPlayIcon,
  MonitorSmartphone as MonitorSmartphoneIcon,
  Moon as MoonIcon,
  Ellipsis as MoreHorizontal,
  Ellipsis as MoreHorizontalIcon,
  MousePointer2 as MousePointer2Icon,
  MoveRight as MoveRightIcon,
  PackageOpen as PackageOpenIcon,
  Palette as PaletteIcon,
  PanelBottom as PanelBottomIcon,
  PanelLeft as PanelLeftIcon,
  PanelRight as PanelRightIcon,
  Paperclip as PaperclipIcon,
  Pause as PauseIcon,
  Pencil as PencilIcon,
  PencilLine as PencilLineIcon,
  PenLine as PenLineIcon,
  Pin as PinIcon,
  PinOff as PinOffIcon,
  Play as PlayIcon,
  Plug as PlugIcon,
  Plus as PlusIcon,
  PriorityHigh as PriorityHighIcon,
  PriorityLow as PriorityLowIcon,
  PriorityMedium as PriorityMediumIcon,
  PriorityNone as PriorityNoneIcon,
  PriorityUrgent as PriorityUrgentIcon,
  Progress as ProgressIcon,
  Quote as QuoteIcon,
  Rectangle as RectangleIcon,
  Redo2 as Redo2Icon,
  Reference as ReferenceIcon,
  RefreshCcw as RefreshCcwIcon,
  RefreshCw as RefreshCwIcon,
  Regenerate as RegenerateIcon,
  RemoveFormatting as RemoveFormattingIcon,
  Repeat as RepeatIcon,
  RotateCcw as RotateCcwIcon,
  Rows3 as Rows3Icon,
  Save as SaveIcon,
  ScrollText as ScrollTextIcon,
  Search as SearchIcon,
  SearchX as SearchXIcon,
  SendHorizontal as SendHorizontalIcon,
  Send as SendIcon,
  Settings2 as Settings2Icon,
  Settings as SettingsIcon,
  ShieldAlert as ShieldAlertIcon,
  ShieldCheck as ShieldCheckIcon,
  ShieldOff as ShieldOffIcon,
  SlidersVertical as Sliders,
  SlidersHorizontal as SlidersHorizontalIcon,
  SlidersVertical as SlidersVerticalIcon,
  Sparkles as SparklesIcon,
  SquareCheck as SquareCheckIcon,
  SquareChevronRight as SquareChevronRightIcon,
  Square as SquareIcon,
  SquarePen as SquarePenIcon,
  SquareTerminal as SquareTerminalIcon,
  Stop as StopIcon,
  Strikethrough as StrikethroughIcon,
  Sun as SunIcon,
  Table2 as Table2Icon,
  Tag as TagIcon,
  Target as TargetIcon,
  Terminal as TerminalIcon,
  SquareTerminal as TerminalSquare,
  TimerReset as TimerResetIcon,
  Trash2 as Trash2Icon,
  TriangleAlert as TriangleAlertIcon,
  Triangle as TriangleIcon,
  Type as TypeIcon,
  Undo2 as Undo2Icon,
  Unlink as UnlinkIcon,
  Upload as UploadIcon,
  User as UserIcon,
  UserRoundCog as UserRoundCogIcon,
  UserRound as UserRoundIcon,
  Users as UsersIcon,
  WifiOff as WifiOffIcon,
  Workflow as WorkflowIcon,
  Worktree as WorktreeIcon,
  WrapText as WrapTextIcon,
  Wrench as WrenchIcon,
  CircleX as XCircle,
  X as XIcon,
  Zap as ZapIcon,
  ZapOff as ZapOffIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
};

export const Volume2 = createUiIcon('Volume2', volume2Icon);
export const VolumeX = createUiIcon('VolumeX', volumeXIcon);
