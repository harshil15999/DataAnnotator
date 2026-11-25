/**
 * Column schema for the CSV export.
 * Defines column names, data types, and mappings from internal p1.field format.
 */

export interface SchemaColumn {
  name: string
  dataType: 'Text' | 'Number' | 'Date' | 'Email' // ponytail: Email for validation only, stored as Text
  notes?: string
  required?: boolean
}

/** Export column names, in the order they appear in the CSV. */
const SCHEMA_COLUMNS: SchemaColumn[] = [
  { name: 'Form_No', dataType: 'Number', required: true },
  { name: 'Grand Father Of Head Of the Family', dataType: 'Text', required: true },
  { name: 'Father Of Head Of the Family', dataType: 'Text', required: true },
  { name: 'Village', dataType: 'Text', required: true },
  { name: 'Total_member', dataType: 'Number', required: true },
  { name: 'Name', dataType: 'Text' },
  { name: 'Father_Husband', dataType: 'Text' },
  { name: 'Surname', dataType: 'Text' },
  { name: 'Relation_with_head', dataType: 'Text' },
  { name: 'Gender', dataType: 'Text' },
  { name: 'Date_of_birth', dataType: 'Date' },
  { name: 'Profile_Image', dataType: 'Text' },
  { name: 'Level_of_education', dataType: 'Text' },
  { name: 'Field_of_education', dataType: 'Text' },
  { name: 'Other_qualification', dataType: 'Text' },
  { name: 'Type_of_Occupation', dataType: 'Text' },
  { name: 'Field_of_Occupation', dataType: 'Text' },
  { name: 'Company_Name', dataType: 'Text' },
  { name: 'Blood_Group', dataType: 'Text' },
  { name: 'Marital_Status', dataType: 'Text' },
  { name: 'Date_of_Marriage', dataType: 'Date' },
  { name: 'Name_of_father', dataType: 'Text' },
  { name: 'Name_of_mother', dataType: 'Text' },
  { name: 'Native_village_of_father', dataType: 'Text' },
  { name: 'Home_Address', dataType: 'Text' },
  { name: 'Land_Mark', dataType: 'Text' },
  { name: 'Area', dataType: 'Text' },
  { name: 'City', dataType: 'Text' },
  { name: 'State', dataType: 'Text' },
  { name: 'Country', dataType: 'Text' },
  { name: 'Pin_Code', dataType: 'Number' },
  { name: 'Office_Address', dataType: 'Text' },
  { name: 'Office_Land_Mark', dataType: 'Text' },
  { name: 'Office_Area', dataType: 'Text' },
  { name: 'Office_City', dataType: 'Text' },
  { name: 'Office_State', dataType: 'Text' },
  { name: 'Office_Country', dataType: 'Text' },
  { name: 'Office_Pin_Code', dataType: 'Number' },
  { name: 'Contact_Information', dataType: 'Number' },
  { name: 'Residence_Phone_No', dataType: 'Text' },
  { name: 'Residence_Phone2', dataType: 'Text' },
  { name: 'Office_Phone_No', dataType: 'Text' },
  { name: 'Office_Phone2', dataType: 'Text' },
  { name: 'Mobile_No1', dataType: 'Number' },
  { name: 'Mobile_No2', dataType: 'Number' },
  { name: 'Email_Id', dataType: 'Email' },
  { name: 'Website_Address', dataType: 'Text' },
  { name: 'Other_Achievements', dataType: 'Text' },
  { name: 'Is_Member_flag', dataType: 'Number' },
  { name: 'Member_flag', dataType: 'Number' },
]

export function getColumnNames(): string[] {
  return SCHEMA_COLUMNS.map(col => col.name)
}

/**
 * Maps export column names back to internal field keys.
 */
const COLUMN_TO_FIELD: Record<string, string> = {
  'Form_No': 'form_no',
  'Grand Father Of Head Of the Family': 'grandfather',
  'Father Of Head Of the Family': 'father',
  'Village': 'village',
  'Total_member': 'total_members',
  'Name': 'name',
  'Father_Husband': 'father_husband',
  'Surname': 'surname',
  'Relation_with_head': 'relation',
  'Gender': 'gender',
  'Date_of_birth': 'dob',
  'Profile_Image': 'profile_image',
  'Level_of_education': 'education_level',
  'Field_of_education': 'education_field',
  'Other_qualification': 'other_qualification',
  'Type_of_Occupation': 'occupation_type',
  'Field_of_Occupation': 'occupation_field',
  'Company_Name': 'company',
  'Blood_Group': 'blood_group',
  'Marital_Status': 'marital_status',
  'Date_of_Marriage': 'marriage_date',
  'Name_of_father': 'father_name',
  'Name_of_mother': 'mother_name',
  'Native_village_of_father': 'native_village',
  'Home_Address': 'home_address',
  'Land_Mark': 'home_landmark',
  'Area': 'home_area',
  'City': 'home_city',
  'State': 'home_state',
  'Country': 'home_country',
  'Pin_Code': 'home_pin',
  'Office_Address': 'office_address',
  'Office_Land_Mark': 'office_landmark',
  'Office_Area': 'office_area',
  'Office_City': 'office_city',
  'Office_State': 'office_state',
  'Office_Country': 'office_country',
  'Office_Pin_Code': 'office_pin',
  'Contact_Information': 'contact_information',
  'Residence_Phone_No': 'residence_phone',
  'Residence_Phone2': 'residence_phone2',
  'Office_Phone_No': 'office_phone',
  'Office_Phone2': 'office_phone2',
  'Mobile_No1': 'mobile1',
  'Mobile_No2': 'mobile2',
  'Email_Id': 'email',
  'Website_Address': 'website',
  'Other_Achievements': 'achievements',
  'Is_Member_flag': 'member',
  'Member_flag': 'member_flag',
}

export function columnToField(colName: string): string | undefined {
  return COLUMN_TO_FIELD[colName]
}

/**
 * Combine grandfather/father name parts into single value for export.
 */
export function constructName(values: Record<string, any>, prefix: string): string {
  const parts = [values[`${prefix}.first`], values[`${prefix}.middle`], values[`${prefix}.last`]]
    .filter(Boolean)
  return parts.join(' ').trim()
}
