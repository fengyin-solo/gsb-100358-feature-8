/**
 * 站点默认通讯方式：老设备登记时没填「通讯方式」，取数与建队列时沿用所属站点的默认值。
 * 键为站点编号（station.站点编号），遥测设备的「所属站点」可填站点编号或站点名称。
 */
export const STATION_DEFAULT_COMM: Record<string, string> = {
  'STAT-0001': '北斗卫星',
  'STAT-0002': '4G',
  'STAT-0003': '超短波',
  'STAT-0004': '4G',
}

/** 匹配不到站点编号时使用的全网默认值 */
export const NETWORK_DEFAULT_COMM = '4G'
