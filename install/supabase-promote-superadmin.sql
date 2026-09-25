update db_personal
set payload = (
  select jsonb_agg(
    case
      when lower(elem->>'email') = lower('alex@gmail.com')
        then elem || jsonb_build_object('role','superadmin')
      else elem
    end
  )
  from jsonb_array_elements(payload) elem
),
updated_at = now()
where id = 'staffUsers';

select jsonb_pretty(payload) from db_personal where id = 'staffUsers';
