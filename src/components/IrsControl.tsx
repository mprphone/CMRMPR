import React, { useMemo, useState } from 'react';
import { Client, FeeGroup } from '../types';
import IrsControlSection from './cashier/IrsControlSection';
import { useIrsControl } from './cashier/useIrsControl';

interface IrsControlProps {
  clients: Client[];
  groups: FeeGroup[];
}

const IrsControl: React.FC<IrsControlProps> = ({ clients, groups }) => {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear() - 1);
  const irsGroup = useMemo(() => groups.find(g => g.name.toLowerCase().includes('irs')), [groups]);
  const irsGroupClients = useMemo(() => {
    if (!irsGroup) return [];
    return clients
      .filter(c => irsGroup.clientIds.includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, irsGroup]);

  const {
    irsControlMap,
    pendingDeliveryTotal,
    pendingDeliveryCount,
    pendingMbWayTotal,
    deliveryHistoryForYear,
    handleCloseDelivery,
    handleIrsDeliveredToggle,
    handleIrsPaidToggle,
    handleIrsPaymentMethodChange,
    handleIrsAmountChange,
    handleIrsNotesChange,
  } = useIrsControl(currentYear);

  return (
    <div className="space-y-6 animate-fade-in">
      <IrsControlSection
        currentYear={currentYear}
        setCurrentYear={setCurrentYear}
        irsGroup={irsGroup}
        irsGroupClients={irsGroupClients}
        irsControlMap={irsControlMap}
        pendingDeliveryTotal={pendingDeliveryTotal}
        pendingDeliveryCount={pendingDeliveryCount}
        pendingMbWayTotal={pendingMbWayTotal}
        deliveryHistoryForYear={deliveryHistoryForYear}
        onCloseDelivery={handleCloseDelivery}
        onToggleDelivered={handleIrsDeliveredToggle}
        onTogglePaid={handleIrsPaidToggle}
        onPaymentMethodChange={handleIrsPaymentMethodChange}
        onAmountChange={handleIrsAmountChange}
        onNotesChange={handleIrsNotesChange}
      />
    </div>
  );
};

export default IrsControl;
