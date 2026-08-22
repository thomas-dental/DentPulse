import { useState, useMemo } from 'react';
import { Folder, FolderOpen, Plus, FileText, ChevronRight, ChevronDown, Pencil, Trash2, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { InvoiceFolder, FolderTreeNode } from '@/hooks/useInvoiceFolders';

interface Location {
  id: string;
  location_name: string;
}

interface InvoiceFolderSidebarProps {
  folders: InvoiceFolder[];
  folderTree: FolderTreeNode[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: () => void;
  onEditFolder?: (folder: InvoiceFolder) => void;
  onDeleteFolder?: (folder: InvoiceFolder) => void;
  totalAllInvoicesCount: number;
  unassignedCount: number;
  isLoading?: boolean;
  folderInvoiceCounts?: Record<string, number>;
  selectedLocationId?: string | null;
  locations?: Location[];
  onCollapse?: () => void;
}


interface FolderItemProps {
  folder: FolderTreeNode;
  level: number;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
  onToggleExpand: (folderId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onEditFolder?: (folder: InvoiceFolder) => void;
  onDeleteFolder?: (folder: InvoiceFolder) => void;
  folderInvoiceCounts: Record<string, number>;
}

function FolderItem({
  folder,
  level,
  selectedFolderId,
  expandedFolders,
  onToggleExpand,
  onSelectFolder,
  onEditFolder,
  onDeleteFolder,
  folderInvoiceCounts,
}: FolderItemProps) {
  const isSelected = selectedFolderId === folder.id;
  const isExpanded = expandedFolders.has(folder.id);
  const hasChildren = folder.children.length > 0;

  // Calculate total count including children recursively
  const calculateTotalCount = (f: FolderTreeNode): number => {
    const directCount = folderInvoiceCounts[f.id] || 0;
    const childrenCount = f.children.reduce((sum, child) => sum + calculateTotalCount(child), 0);
    return directCount + childrenCount;
  };
  const invoiceCount = calculateTotalCount(folder);

  const handleClick = () => {
    onSelectFolder(folder.id);
    // Toggle expand/collapse when clicking on a folder with children
    if (hasChildren) {
      onToggleExpand(folder.id);
    }
  };

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors min-w-0',
          isSelected
            ? 'bg-indigo-100 text-indigo-900'
            : 'hover:bg-gray-100 text-gray-700'
        )}
        style={{ paddingLeft: `${8 + level * 16}px` }}
        onClick={handleClick}
      >
        {/* {hasChildren ? (
          <button
            className="p-0.5 hover:bg-gray-200 rounded"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(folder.id);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )} */}

        <div
          className={cn(
            'w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
            isSelected ? 'bg-indigo-200' : 'bg-gray-100'
          )}
        >
          {isExpanded ? (
            <FolderOpen className={cn('w-3.5 h-3.5', isSelected ? 'text-indigo-600' : 'text-gray-600')} />
          ) : (
            <Folder className={cn('w-3.5 h-3.5', isSelected ? 'text-indigo-600' : 'text-gray-600')} />
          )}
        </div>

        <span className={cn('flex-1 text-sm truncate', isSelected && 'font-medium')}>
          {folder.name}
        </span>

        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded flex-shrink-0',
          folder.type !== 'default' && 'group-hover:hidden', // Only hide on hover for non-default folders
          isSelected ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-100 text-gray-500'
        )}>
          {invoiceCount}
        </span>

        {/* Edit and Delete icons - shown on hover (only for non-system folders) */}
        {folder.type !== 'default' && (
          <div className="hidden group-hover:flex items-center gap-1">
            <button
              className="p-1 hover:bg-gray-200 rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onEditFolder?.(folder);
              }}
              title="Edit folder"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-500 hover:text-indigo-600" />
            </button>
            <button
              className="p-1 hover:bg-red-100 rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder?.(folder);
              }}
              title="Delete folder"
            >
              <Trash2 className="w-3.5 h-3.5 text-gray-500 hover:text-red-600" />
            </button>
          </div>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div>
          {folder.children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              selectedFolderId={selectedFolderId}
              expandedFolders={expandedFolders}
              onToggleExpand={onToggleExpand}
              onSelectFolder={onSelectFolder}
              onEditFolder={onEditFolder}
              onDeleteFolder={onDeleteFolder}
              folderInvoiceCounts={folderInvoiceCounts}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function InvoiceFolderSidebar({
  folders,
  folderTree,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  totalAllInvoicesCount,
  unassignedCount,
  isLoading,
  folderInvoiceCounts = {},
  selectedLocationId,
  locations = [],
  onCollapse,
}: InvoiceFolderSidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Start with all locations collapsed by default
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  const toggleExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // Toggle location expand/collapse (accordion behavior - only one open at a time)
  const toggleLocationExpand = (locationId: string) => {
    setExpandedLocations((prev) => {
      const next = new Set<string>();
      // If clicking on already expanded location, collapse it
      // Otherwise, expand only the clicked location (close others)
      if (!prev.has(locationId)) {
        next.add(locationId);
      }
      return next;
    });
  };

  // Build folder tree grouped by location when "All" locations is selected
  const foldersGroupedByLocation = useMemo(() => {
    if (selectedLocationId) {
      // When a specific location is selected, don't group - use filtered tree instead
      return null;
    }

    console.log('[FolderSidebar] Building grouped folders from', folders.length, 'folders');

    // Create location groups from the FOLDERS themselves (not from locations prop)
    // This ensures all folders are displayed regardless of locations prop
    const locationMap = new Map<string, { folders: InvoiceFolder[]; locationName: string }>();

    // Group folders by location_id - use folder's location_name for display
    folders.forEach((folder) => {
      const locId = folder.location_id;
      if (locId) {
        if (!locationMap.has(locId)) {
          // Create new location group using folder's location_name
          locationMap.set(locId, {
            folders: [],
            locationName: folder.location_name || 'Unknown Location'
          });
        }
        locationMap.get(locId)!.folders.push(folder);
      }
    });

    console.log('[FolderSidebar] Found', locationMap.size, 'unique locations from folders');

    // Build tree for each location
    const result: { locationId: string | null; locationName: string; tree: FolderTreeNode[] }[] = [];

    locationMap.forEach((data, locId) => {
      const { folders: locationFolders, locationName } = data;

      // Build tree from flat folders
      const buildTree = (parentId: string | null): FolderTreeNode[] => {
        return locationFolders
          .filter((f) => f.parent_id === parentId)
          .map((folder) => ({
            ...folder,
            children: buildTree(folder.id),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      };

      const tree = buildTree(null);
      console.log('[FolderSidebar] Location:', locationName, '- Root folders:', tree.length);

      result.push({
        locationId: locId,
        locationName,
        tree,
      });
    });

    // Sort by location name
    return result.sort((a, b) => a.locationName.localeCompare(b.locationName));
  }, [folders, selectedLocationId]);

  // Filter folder tree for specific location
  const filteredFolderTree = useMemo(() => {
    if (!selectedLocationId) {
      return folderTree;
    }

    // Filter to only include folders for the selected location
    const filterTree = (nodes: FolderTreeNode[]): FolderTreeNode[] => {
      return nodes
        .filter((node) => node.location_id === selectedLocationId)
        .map((node) => ({
          ...node,
          children: filterTree(node.children),
        }));
    };

    return filterTree(folderTree);
  }, [folderTree, selectedLocationId]);

  if (isLoading) {
    return (
      <div className="w-full bg-white flex flex-col h-full min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 gap-1">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-shrink-0">
            Folders
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-gray-400 flex-shrink-0"
            disabled
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="ml-1 hidden sm:inline">New Folder</span>
          </Button>
        </div>

        {/* Loading Skeleton */}
        <div className="p-2 space-y-1">
          {/* All Documents Skeleton */}
          <div className="flex items-center gap-2 px-2 py-1.5 bg-indigo-50 rounded-md">
            <div className="w-6 h-6 rounded bg-indigo-200 animate-pulse flex-shrink-0" />
            <div className="flex-1 h-4 bg-indigo-200 rounded animate-pulse" />
            <div className="w-6 h-5 bg-indigo-200 rounded animate-pulse flex-shrink-0" />
          </div>

          {/* Location Skeletons (collapsed state) */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 mt-2">
              <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
              <div className="flex-1 h-4 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-white flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 gap-1">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-shrink-0">
          Folders
        </h3>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 flex-shrink-0"
            onClick={onCreateFolder}
            title="New Folder"
          >
            <Plus className="w-4 h-4" />
          </Button>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
              onClick={onCollapse}
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Folder List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {/* All Documents */}
          <div
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors min-w-0',
              selectedFolderId === null
                ? 'bg-indigo-100 text-indigo-900'
                : 'hover:bg-gray-100 text-gray-700'
            )}
            onClick={() => onSelectFolder(null)}
          >
            <div
              className={cn(
                'w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
                selectedFolderId === null ? 'bg-indigo-200' : 'bg-gray-100'
              )}
            >
              <FileText className={cn('w-3.5 h-3.5', selectedFolderId === null ? 'text-indigo-600' : 'text-gray-600')} />
            </div>
            <span className={cn('flex-1 text-sm truncate min-w-0', selectedFolderId === null && 'font-medium')}>
              All Documents
            </span>
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded flex-shrink-0',
              selectedFolderId === null ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-100 text-gray-500'
            )}>
              {totalAllInvoicesCount}
            </span>
          </div>

          {/* Show folders grouped by location when "All" locations is selected */}
          {!selectedLocationId && foldersGroupedByLocation ? (
            <>
              {foldersGroupedByLocation.map((group) => {
                const isExpanded = expandedLocations.has(group.locationId || 'org');
                const locationKey = group.locationId || 'org';

                return (
                  <div key={locationKey} className="mt-3">
                    {/* Location Header */}
                    <div
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => toggleLocationExpand(locationKey)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide truncate min-w-0">
                        {group.locationName}
                      </span>
                    </div>

                    {/* Location Folders */}
                    {isExpanded && (
                      <div className="mt-0.5 ml-2 border-l border-gray-200 pl-2">
                        {group.tree.length > 0 ? (
                          group.tree.map((folder) => (
                            <FolderItem
                              key={folder.id}
                              folder={folder}
                              level={0}
                              selectedFolderId={selectedFolderId}
                              expandedFolders={expandedFolders}
                              onToggleExpand={toggleExpand}
                              onSelectFolder={onSelectFolder}
                              onEditFolder={onEditFolder}
                              onDeleteFolder={onDeleteFolder}
                              folderInvoiceCounts={folderInvoiceCounts}
                            />
                          ))
                        ) : (
                          <div className="px-2 py-1 text-xs text-gray-400 italic">
                            No folders
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            /* Show filtered folder tree when specific location is selected */
            filteredFolderTree.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={folder}
                level={0}
                selectedFolderId={selectedFolderId}
                expandedFolders={expandedFolders}
                onToggleExpand={toggleExpand}
                onSelectFolder={onSelectFolder}
                onEditFolder={onEditFolder}
                onDeleteFolder={onDeleteFolder}
                folderInvoiceCounts={folderInvoiceCounts}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
