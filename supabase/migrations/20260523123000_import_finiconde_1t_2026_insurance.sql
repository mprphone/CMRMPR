do $migration$
declare
  v_total integer := 0;
  v_updated integer := 0;
  v_inserted integer := 0;
begin
  if to_regclass('public.insurance_policies') is null then
    raise exception 'insurance_policies table does not exist';
  end if;

  create temporary table tmp_finiconde_pdf_policies (
    insured text not null,
    policy_number text not null,
    company text not null,
    branch text not null,
    movement_date date not null,
    premium_value numeric not null,
    commission_value numeric not null,
    doc_number text not null
  ) on commit drop;

  insert into tmp_finiconde_pdf_policies (insured, policy_number, company, branch, movement_date, premium_value, commission_value, doc_number)
  values
    ('AGOSTINHO CASTRO NOBRE', '206422659', 'Allianz', 'Automovel', '2026-01-20'::date, 221.46, 16.74, '592243780'),
    ('ANDRE HENRIQUES RIBEIRO', '206058728', 'Allianz', 'Automovel', '2025-12-18'::date, 159.25, 11.99, '587444211'),
    ('ANTONIO AGOSTINHO RIBEIRO MAGALHAES', '205235042', 'Allianz', 'Automovel', '2025-12-18'::date, 221.45, 22.52, '585819489'),
    ('ANTONIO FERNANDES SILVA', '206043262', 'Allianz', 'Automovel', '2025-12-18'::date, 277.27, 20.81, '586138814'),
    ('ANTONIO MARTINS FERNANDES', '201952776', 'Allianz', 'Automovel', '2026-01-20'::date, 282.86, 21.25, '593337284'),
    ('ANTONIO MARTINS FERNANDES', '204733414', 'Allianz', 'Automovel', '2025-12-18'::date, 2.27, 0.11, '587427380'),
    ('ANTONIO MARTINS FERNANDES', '204733423', 'Allianz', 'Automovel', '2025-12-18'::date, 70.62, 5.20, '587427398'),
    ('CASA PASTO JUSTINIANO LDA', '207886511', 'Allianz', 'Ac Trabalho', '2026-02-27'::date, 31.68, 2.97, '600704500'),
    ('CRISTINA ALVES RIBEIRO', '206798577', 'Allianz', 'Automovel', '2026-01-20'::date, 263.53, 19.94, '592428217'),
    ('FAÇANHA INVENSÍVEL, UNIPESSOAL, LDA', '208071278', 'Allianz', 'Ac Trabalho', '2026-02-06'::date, 238.31, 24.79, '596619779'),
    ('FAVORITE MOUNTAIN INVESTIMENTOS LDA', '0010307559', 'Tranquilidade', 'Ac Trabalho', '2026-02-21'::date, 447.95, 40.18, '0138357043'),
    ('FORTUNE AVAILABLE LDA', '0010635681', 'Tranquilidade', 'Multi Risco', '2026-01-19'::date, 172.58, 26.47, '0137269644'),
    ('FORTUNE AVAILABLE LDA', '207894587', 'Allianz', 'Ac Trabalho', '2026-02-27'::date, 52.22, 4.85, '600704807'),
    ('JACINTO RODRIGUES PEREIRA', '0009837584', 'Tranquilidade', 'Ac Trabalho', '2026-01-21'::date, 19.80, 1.09, '0137334175'),
    ('JACINTO RODRIGUES PEREIRA', '205272656', 'Allianz', 'Automovel', '2026-01-20'::date, 227.61, 17.05, '591729144'),
    ('JORGE FERNANDO PEREIRA NEPOMUCENO', '205097496', 'Allianz', 'Saude', '2026-02-21'::date, 9.00, 1.26, '597996531'),
    ('JOSE CARLOS OLIVEIRA RIBEIRO', '204768570', 'Allianz', 'Automovel', '2026-01-20'::date, 87.69, 6.47, '593389673'),
    ('JTRADE, LDA', '726729', 'SABSEG', 'Caucoes', '2025-12-01'::date, 1472.63, 136.75, '41248'),
    ('MANUEL ALCIDIO OLIVEIRA RIBEIRO', '207156691', 'Allianz', 'Automovel', '2026-01-20'::date, 211.40, 16.00, '592619195'),
    ('MANUEL FREITAS BATISTA', '207141595', 'Allianz', 'Multi Risco', '2025-12-18'::date, 169.07, 18.72, '586732251'),
    ('MANUEL FREITAS BATISTA', '207170659', 'Allianz', 'Casa', '2026-01-20'::date, 479.63, 53.10, '592648160'),
    ('MARIA JOSE ABREU CAB E ESTETICA LDA', '207904255', 'Allianz', 'Ac Trabalho', '2026-02-21'::date, 38.14, 2.84, '600313195'),
    ('MARTA LUCILIA SALGADO SOARES', '208068074', 'Allianz', 'Responsabilidade Civil', '2026-01-28'::date, 29.62, 4.75, '168340960'),
    ('MPR NEGOCIOS LDA', '208033618', 'Allianz', 'Ac Trabalho', '2025-12-31'::date, 96.69, 8.63, '588908594'),
    ('PEDRO MIGUEL FREITAS NOVAIS', '205292187', 'Allianz', 'Automovel', '2026-02-21'::date, 422.55, 43.21, '598053381'),
    ('POWERFAFE KLIMA LDA', '0009793887', 'Tranquilidade', 'Ac Trabalho', '2026-02-07'::date, 591.50, 44.58, '0137910336'),
    ('POWERFAFE KLIMA LDA', '203112341', 'Allianz', 'Responsabilidade Civil', '2026-01-20'::date, 506.71, 58.11, '593608023'),
    ('POWERFAFE KLIMA LDA', '207573304', 'Allianz', 'Automovel', '2025-12-18'::date, 1470.92, 111.66, '587020912'),
    ('SABORES OPULENTOS LDA', '207903609', 'Allianz', 'Ac Trabalho', '2026-02-27'::date, 193.81, 18.28, '600705168'),
    ('SONIA SUSANA FERNANDES SOUSA', '205187161', 'Allianz', 'Automovel', '2025-12-18'::date, 336.55, 25.40, '585786886');

  select count(*) into v_total from tmp_finiconde_pdf_policies;

  create temporary table tmp_finiconde_prepared on commit drop as
  select
    gen_random_uuid() as id,
    coalesce(matched_client.id, mediator_client.id) as client_id,
    p.insured,
    p.policy_number,
    p.company,
    p.branch,
    p.movement_date,
    p.premium_value,
    p.commission_value,
    p.doc_number,
    case when p.premium_value > 0 then round((p.commission_value / p.premium_value) * 100, 2) else 0 end as commission_rate
  from tmp_finiconde_pdf_policies p
  left join lateral (
    select c.id
    from public.clients c
    where lower(regexp_replace(translate(c.name, '??????????????????????????????????????????????', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '[^A-Za-z0-9]+', '', 'g')) = lower(regexp_replace(translate(p.insured, '??????????????????????????????????????????????', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '[^A-Za-z0-9]+', '', 'g'))
    order by c.name
    limit 1
  ) matched_client on true
  left join lateral (
    select c.id
    from public.clients c
    where lower(regexp_replace(translate(c.name, '??????????????????????????????????????????????', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '[^A-Za-z0-9]+', '', 'g')) = lower(regexp_replace(translate('Paula Ernestina Rodrigues Silva', '??????????????????????????????????????????????', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '[^A-Za-z0-9]+', '', 'g'))
       or c.name ilike '%Paula Ernestina Rodrigues Silva%'
    order by c.name
    limit 1
  ) mediator_client on true;

  update public.insurance_policies ip
     set policy_holder = p.insured,
         client_id = coalesce(ip.client_id, p.client_id),
         mediator_partner = 'Finiconde',
         company = p.company,
         insurance_provider = p.company,
         branch = p.branch,
         policy_type = p.branch,
         policy_date = p.movement_date,
         renewal_date = p.movement_date,
         premium_value = p.premium_value,
         net_premium_value = p.premium_value,
         commission_rate = p.commission_rate,
         has_receipt = true,
         status = coalesce(ip.status, 'Aceite'),
         communication_type = coalesce(nullif(ip.communication_type, ''), 'Via Mediador'),
         notes = concat_ws(E'\n', nullif(ip.notes, ''), 'Atualizado por import PDF Finiconde 1T 2026; recibo ' || p.doc_number || '; segurado ' || p.insured)
    from tmp_finiconde_prepared p
   where ip.policy_number = p.policy_number
      or nullif(ltrim(ip.policy_number, '0'), '') = nullif(ltrim(p.policy_number, '0'), '');
  get diagnostics v_updated = row_count;

  insert into public.insurance_policies (
    id, client_id, policy_holder, agent, mediator_partner, internal_responsible, policy_date, renewal_date,
    policy_number, company, branch, insurance_provider, payment_frequency, policy_type, premium_value,
    net_premium_value, commission_rate, commission_paid, has_receipt, status, communication_type, notes, policy_tier, document_checklist
  )
  select
    p.id, p.client_id, p.insured, 'Paula', 'Finiconde', 'Paula', p.movement_date, p.movement_date,
    p.policy_number, p.company, p.branch, p.company, 'Anual', p.branch, p.premium_value,
    p.premium_value, p.commission_rate, false, true, 'Aceite', 'Via Mediador',
    'Criado por import PDF Finiconde 1T 2026; recibo ' || p.doc_number || '; segurado ' || p.insured,
    'Base', '{}'::jsonb
  from tmp_finiconde_prepared p
  where not exists (
    select 1
    from public.insurance_policies ip
    where ip.policy_number = p.policy_number
       or nullif(ltrim(ip.policy_number, '0'), '') = nullif(ltrim(p.policy_number, '0'), '')
  );
  get diagnostics v_inserted = row_count;

  raise notice 'Import Finiconde 1T 2026: total %, atualizadas %, criadas %', v_total, v_updated, v_inserted;
end;
$migration$;
