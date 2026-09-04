/**
 * Curated catalogue of valid Service icon keys. Each key is the exact export
 * name of a `lucide-react` icon component, so the frontend can render a
 * service's icon with a single dynamic lookup (`LucideIcons[service.icon]`)
 * keyed off the service's own row - never off its position in a list.
 * Reordering, filtering, or paginating services can never mismatch an icon
 * again, because the icon travels with the service, not with an index.
 *
 * This is also the single source of truth admin tooling uses to render an
 * icon picker (see GET /api/admin/services?view=icons): Service.icon is
 * validated against SERVICE_ICON_VALUES on create/update, so an admin can
 * only ever choose an icon that is guaranteed to exist on the frontend.
 *
 * Adding a new option is a one-line change here - it never requires a
 * database migration, since Service.icon is a plain validated string column.
 */
export const SERVICE_ICON_OPTIONS = [
  { value: 'Zap', label: 'Electrician' },
  { value: 'Droplets', label: 'Plumbing' },
  { value: 'Paintbrush', label: 'Painting' },
  { value: 'Hammer', label: 'Carpentry' },
  { value: 'Truck', label: 'Moving' },
  { value: 'Sprout', label: 'Gardening' },
  { value: 'Wrench', label: 'General repair' },
  { value: 'Sparkles', label: 'Cleaning' },
  { value: 'FileText', label: 'Handyman / documentation' },
  { value: 'Home', label: 'Home services' },
  { value: 'Bug', label: 'Pest control' },
  { value: 'Fan', label: 'Ventilation' },
  { value: 'Thermometer', label: 'Heating' },
  { value: 'Snowflake', label: 'Air conditioning' },
  { value: 'Flame', label: 'Gas / heating' },
  { value: 'Car', label: 'Automotive' },
  { value: 'PawPrint', label: 'Pet care' },
  { value: 'Shirt', label: 'Laundry' },
  { value: 'Scissors', label: 'Landscaping / grooming' },
  { value: 'Lock', label: 'Locksmith' },
  { value: 'KeyRound', label: 'Security / access' },
  { value: 'ShieldCheck', label: 'Security services' },
  { value: 'Tv', label: 'Electronics' },
  { value: 'Wifi', label: 'IT / networking' },
  { value: 'Baby', label: 'Babysitting / childcare' },
  { value: 'Dumbbell', label: 'Fitness training' },
  { value: 'Warehouse', label: 'Storage' },
  { value: 'Package', label: 'Delivery / packing' },
  { value: 'Recycle', label: 'Waste management' },
  { value: 'Flower2', label: 'Landscaping' },
  { value: 'TreePine', label: 'Tree services' },
  { value: 'Sun', label: 'Solar / outdoor' },
  { value: 'Wind', label: 'Ventilation' },
  { value: 'HardHat', label: 'Construction' },
  { value: 'Ruler', label: 'Renovation / measurement' },
  { value: 'Drill', label: 'Power tools' },
  { value: 'Briefcase', label: 'Professional services' },
  { value: 'Sofa', label: 'Furniture' },
  { value: 'ShowerHead', label: 'Bathroom services' },
  { value: 'Refrigerator', label: 'Appliance repair' },
  { value: 'Plug', label: 'Electrical fixtures' },
  { value: 'Lightbulb', label: 'Lighting' },
  { value: 'Settings', label: 'General maintenance' },
  { value: 'Leaf', label: 'Eco / garden' },
  { value: 'MapPin', label: 'On-site services' },
] as const;

export type ServiceIconValue = (typeof SERVICE_ICON_OPTIONS)[number]['value'];

export const SERVICE_ICON_VALUES: string[] = SERVICE_ICON_OPTIONS.map((option) => option.value);
