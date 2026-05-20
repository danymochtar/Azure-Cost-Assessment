export interface VmSku {
  armName: string;
  display: string;
  family: "burstable" | "general" | "memory";
  vcpu: number;
  memoryGb: number;
  meterMatch: string;
  priority: number;
}

export const BURSTABLE: VmSku[] = [
  { armName: "Standard_B1s",   display: "B1s",   family: "burstable", vcpu: 1,  memoryGb: 1,  meterMatch: "B1s",   priority: 5 },
  { armName: "Standard_B1ms",  display: "B1ms",  family: "burstable", vcpu: 1,  memoryGb: 2,  meterMatch: "B1ms",  priority: 5 },
  { armName: "Standard_B2s",   display: "B2s",   family: "burstable", vcpu: 2,  memoryGb: 4,  meterMatch: "B2s",   priority: 5 },
  { armName: "Standard_B2ms",  display: "B2ms",  family: "burstable", vcpu: 2,  memoryGb: 8,  meterMatch: "B2ms",  priority: 5 },
  { armName: "Standard_B4ms",  display: "B4ms",  family: "burstable", vcpu: 4,  memoryGb: 16, meterMatch: "B4ms",  priority: 5 },
  { armName: "Standard_B8ms",  display: "B8ms",  family: "burstable", vcpu: 8,  memoryGb: 32, meterMatch: "B8ms",  priority: 5 },
  { armName: "Standard_B12ms", display: "B12ms", family: "burstable", vcpu: 12, memoryGb: 48, meterMatch: "B12ms", priority: 5 },
  { armName: "Standard_B16ms", display: "B16ms", family: "burstable", vcpu: 16, memoryGb: 64, meterMatch: "B16ms", priority: 5 },
  { armName: "Standard_B20ms", display: "B20ms", family: "burstable", vcpu: 20, memoryGb: 80, meterMatch: "B20ms", priority: 5 },
];

export const GENERAL: VmSku[] = [
  { armName: "Standard_D2s_v5",  display: "D2s v5",  family: "general", vcpu: 2,  memoryGb: 8,   meterMatch: "D2s v5",  priority: 10 },
  { armName: "Standard_D4s_v5",  display: "D4s v5",  family: "general", vcpu: 4,  memoryGb: 16,  meterMatch: "D4s v5",  priority: 10 },
  { armName: "Standard_D8s_v5",  display: "D8s v5",  family: "general", vcpu: 8,  memoryGb: 32,  meterMatch: "D8s v5",  priority: 10 },
  { armName: "Standard_D16s_v5", display: "D16s v5", family: "general", vcpu: 16, memoryGb: 64,  meterMatch: "D16s v5", priority: 10 },
  { armName: "Standard_D32s_v5", display: "D32s v5", family: "general", vcpu: 32, memoryGb: 128, meterMatch: "D32s v5", priority: 10 },
  { armName: "Standard_D48s_v5", display: "D48s v5", family: "general", vcpu: 48, memoryGb: 192, meterMatch: "D48s v5", priority: 10 },
  { armName: "Standard_D64s_v5", display: "D64s v5", family: "general", vcpu: 64, memoryGb: 256, meterMatch: "D64s v5", priority: 10 },
];

export const MEMORY: VmSku[] = [
  { armName: "Standard_E2s_v5",  display: "E2s v5",  family: "memory", vcpu: 2,  memoryGb: 16,  meterMatch: "E2s v5",  priority: 10 },
  { armName: "Standard_E4s_v5",  display: "E4s v5",  family: "memory", vcpu: 4,  memoryGb: 32,  meterMatch: "E4s v5",  priority: 10 },
  { armName: "Standard_E8s_v5",  display: "E8s v5",  family: "memory", vcpu: 8,  memoryGb: 64,  meterMatch: "E8s v5",  priority: 10 },
  { armName: "Standard_E16s_v5", display: "E16s v5", family: "memory", vcpu: 16, memoryGb: 128, meterMatch: "E16s v5", priority: 10 },
  { armName: "Standard_E32s_v5", display: "E32s v5", family: "memory", vcpu: 32, memoryGb: 256, meterMatch: "E32s v5", priority: 10 },
  { armName: "Standard_E48s_v5", display: "E48s v5", family: "memory", vcpu: 48, memoryGb: 384, meterMatch: "E48s v5", priority: 10 },
  { armName: "Standard_E64s_v5", display: "E64s v5", family: "memory", vcpu: 64, memoryGb: 512, meterMatch: "E64s v5", priority: 10 },
];

export const VM_CATALOG: VmSku[] = [...BURSTABLE, ...GENERAL, ...MEMORY];
